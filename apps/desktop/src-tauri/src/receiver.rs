use axum::{
    body::{to_bytes, Body},
    extract::State,
    http::{Request, StatusCode},
    routing::post,
    Router,
};
use pit_stop_core::Event;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use tokio::sync::mpsc;

#[derive(Clone)]
pub struct ReceiverState {
    pub token: Arc<String>,
    pub tx: mpsc::Sender<Event>,
    pub rejected: Arc<AtomicU64>,
    pub rejections: Arc<Mutex<std::collections::BTreeMap<u16, u64>>>,
    rate: Arc<Mutex<(std::time::Instant, f64)>>,
    permits: Arc<tokio::sync::Semaphore>,
}
impl ReceiverState {
    pub fn new(token: String, tx: mpsc::Sender<Event>) -> Self {
        Self {
            token: Arc::new(token),
            tx,
            rejected: Arc::new(AtomicU64::new(0)),
            rejections: Arc::new(Mutex::new(std::collections::BTreeMap::new())),
            rate: Arc::new(Mutex::new((std::time::Instant::now(), 200.0))),
            permits: Arc::new(tokio::sync::Semaphore::new(64)),
        }
    }
    fn reject(&self, status: StatusCode) -> StatusCode {
        self.rejected.fetch_add(1, Ordering::Relaxed);
        if let Ok(mut classes) = self.rejections.lock() {
            *classes.entry(status.as_u16()).or_default() += 1;
        }
        status
    }
}
pub fn router(state: ReceiverState) -> Router {
    Router::new()
        .route("/v1/events", post(receive))
        .with_state(state)
}
fn token_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |v, (a, b)| v | (a ^ b)) == 0
}
async fn receive(State(state): State<ReceiverState>, req: Request<Body>) -> StatusCode {
    let Ok(_permit) = state.permits.try_acquire() else {
        return state.reject(StatusCode::TOO_MANY_REQUESTS);
    };
    let headers = req.headers();
    if headers.contains_key("origin") {
        return state.reject(StatusCode::FORBIDDEN);
    }
    if headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or("").trim())
        != Some("application/json")
    {
        return state.reject(StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }
    let expected = format!("Bearer {}", state.token);
    if !headers
        .get("authorization")
        .map(|v| token_eq(v.as_bytes(), expected.as_bytes()))
        .unwrap_or(false)
    {
        return state.reject(StatusCode::UNAUTHORIZED);
    }
    {
        let Ok(mut rate) = state.rate.lock() else {
            return StatusCode::SERVICE_UNAVAILABLE;
        };
        let now = std::time::Instant::now();
        rate.1 = (rate.1 + now.duration_since(rate.0).as_secs_f64() * 200.0).min(200.0);
        rate.0 = now;
        if rate.1 < 1.0 {
            return state.reject(StatusCode::TOO_MANY_REQUESTS);
        }
        rate.1 -= 1.0;
    }
    let body = match tokio::time::timeout(
        std::time::Duration::from_millis(200),
        to_bytes(req.into_body(), 8192),
    )
    .await
    {
        Ok(Ok(body)) => body,
        Ok(Err(_)) => return state.reject(StatusCode::PAYLOAD_TOO_LARGE),
        Err(_) => return state.reject(StatusCode::REQUEST_TIMEOUT),
    };
    let Ok(event) = serde_json::from_slice::<Event>(&body) else {
        return state.reject(StatusCode::BAD_REQUEST);
    };
    if event.validate().is_err() {
        return state.reject(StatusCode::BAD_REQUEST);
    }
    match state.tx.try_send(event) {
        Ok(()) => StatusCode::ACCEPTED,
        Err(_) => state.reject(StatusCode::SERVICE_UNAVAILABLE),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use tower::ServiceExt;
    async fn request(headers: &[(&str, &str)], body: String) -> StatusCode {
        let (tx, _rx) = mpsc::channel(16);
        let router = router(ReceiverState::new("secret".into(), tx));
        let mut req = Request::builder().method("POST").uri("/v1/events");
        for (k, v) in headers {
            req = req.header(*k, *v);
        }
        router
            .oneshot(req.body(Body::from(body)).unwrap())
            .await
            .unwrap()
            .status()
    }
    #[tokio::test]
    async fn denies_browser_and_bad_auth() {
        assert_eq!(
            request(
                &[
                    ("origin", "https://evil.test"),
                    ("content-type", "application/json")
                ],
                "{}".into()
            )
            .await,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            request(&[("content-type", "application/json")], "{}".into()).await,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            request(&[], "{}".into()).await,
            StatusCode::UNSUPPORTED_MEDIA_TYPE
        );
    }
    #[test]
    fn failure_counters_are_fixed_status_counts_only() {
        let (tx, _rx) = mpsc::channel(1);
        let state = ReceiverState::new("secret".into(), tx);
        state.reject(StatusCode::UNAUTHORIZED);
        state.reject(StatusCode::UNAUTHORIZED);
        state.reject(StatusCode::BAD_REQUEST);
        assert_eq!(state.rejected.load(Ordering::Relaxed), 3);
        assert_eq!(state.rejections.lock().unwrap().get(&401), Some(&2));
        assert_eq!(state.rejections.lock().unwrap().len(), 2);
    }
    #[tokio::test]
    async fn limits_payload_and_rejects_schema() {
        let h = [
            ("authorization", "Bearer secret"),
            ("content-type", "application/json"),
        ];
        assert_eq!(
            request(&h, "x".repeat(8193)).await,
            StatusCode::PAYLOAD_TOO_LARGE
        );
        assert_eq!(
            request(&h, "{\"version\":99}".into()).await,
            StatusCode::BAD_REQUEST
        );
    }
    #[tokio::test]
    async fn valid_event_is_enqueued_and_duplicate_is_not_replayed() {
        let (tx, mut rx) = mpsc::channel(4);
        let app = router(ReceiverState::new("secret".into(), tx));
        let event=pit_stop_core::normalize(pit_stop_core::Source::Claude,None,&serde_json::json!({"hook_event_name":"PreToolUse","session_id":"synthetic","tool_use_id":"1","tool_name":"Read"}),&[42;32]).unwrap();
        let body = serde_json::to_string(&event).unwrap();
        for _ in 0..2 {
            let request = Request::builder()
                .method("POST")
                .uri("/v1/events")
                .header("content-type", "application/json")
                .header("authorization", "Bearer secret")
                .body(Body::from(body.clone()))
                .unwrap();
            assert_eq!(
                app.clone().oneshot(request).await.unwrap().status(),
                StatusCode::ACCEPTED
            );
        }
        let mut sessions = crate::sessions::Sessions::default();
        assert!(sessions.accept(rx.recv().await.unwrap()).is_some());
        assert!(sessions.accept(rx.recv().await.unwrap()).is_none());
        assert_eq!(sessions.accepted, 1);
    }
    #[tokio::test]
    async fn queue_backpressure_never_waits_for_renderer() {
        let (tx, _rx) = mpsc::channel(1);
        let app = router(ReceiverState::new("secret".into(), tx));
        let event=pit_stop_core::normalize(pit_stop_core::Source::Codex,None,&serde_json::json!({"type":"agent-turn-complete","thread-id":"synthetic","turn-id":"1"}),&[42;32]).unwrap();
        for expected in [StatusCode::ACCEPTED, StatusCode::SERVICE_UNAVAILABLE] {
            let request = Request::builder()
                .method("POST")
                .uri("/v1/events")
                .header("content-type", "application/json")
                .header("authorization", "Bearer secret")
                .body(Body::from(serde_json::to_vec(&event).unwrap()))
                .unwrap();
            assert_eq!(
                tokio::time::timeout(
                    std::time::Duration::from_millis(100),
                    app.clone().oneshot(request)
                )
                .await
                .unwrap()
                .unwrap()
                .status(),
                expected
            );
        }
    }
    #[tokio::test]
    #[ignore = "60-second sustained authenticated loopback stress test; run explicitly before release"]
    async fn sustained_100_events_per_second_for_60_seconds() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let (tx, mut rx) = mpsc::channel(512);
        let state = ReceiverState::new("secret".into(), tx);
        let rejected = state.rejected.clone();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, router(state)).await.unwrap();
        });
        let consumed = Arc::new(Mutex::new(crate::sessions::Sessions::default()));
        let result = consumed.clone();
        let consumer = tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                result.lock().unwrap().accept(event);
            }
        });
        let start = tokio::time::Instant::now();
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(100));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        for batch in 0..600 {
            interval.tick().await;
            for n in 0..10 {
                let event=pit_stop_core::normalize(pit_stop_core::Source::Claude,None,&serde_json::json!({"hook_event_name":"PostToolUse","session_id":format!("session-{}",batch%8),"tool_use_id":format!("{}",batch*10+n),"tool_name":"Read"}),&[42;32]).unwrap();
                let body = serde_json::to_string(&event).unwrap();
                let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
                stream.write_all(format!("POST /v1/events HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer secret\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).as_bytes()).await.unwrap();
                let mut response = Vec::new();
                tokio::time::timeout(
                    std::time::Duration::from_secs(2),
                    stream.read_to_end(&mut response),
                )
                .await
                .unwrap()
                .unwrap();
                assert!(
                    response.starts_with(b"HTTP/1.1 202"),
                    "event {}: {}",
                    batch * 10 + n,
                    String::from_utf8_lossy(&response)
                );
            }
        }
        eprintln!(
            "6000 authenticated events in {:.2}s",
            start.elapsed().as_secs_f64()
        );
        assert_eq!(rejected.load(Ordering::Relaxed), 0);
        let summary = consumed.lock().unwrap().summary();
        assert_eq!(summary.accepted, 6000);
        assert_eq!(summary.history, 200);
        assert!(summary.sessions <= 8);
        assert_eq!(summary.active_tools, 0);
        server.abort();
        consumer.abort();
    }
}
