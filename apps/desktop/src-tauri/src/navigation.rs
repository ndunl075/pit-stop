use tauri::Url;

// CSP limits subresources; this separately prevents top-level remote navigation.
// WebView2's own OS-managed diagnostics are outside the page navigation API.
pub fn is_local_page(url: &Url, development: bool) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    match (url.scheme(), url.host_str(), url.port_or_known_default()) {
        ("tauri", Some("localhost"), None) => true,
        ("http", Some("tauri.localhost"), Some(80)) => true,
        ("http", Some("localhost" | "127.0.0.1"), Some(1420)) if development => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packaged_pages_are_local_and_dev_server_is_debug_only() {
        for page in ["tauri://localhost/", "http://tauri.localhost/index.html"] {
            assert!(is_local_page(&Url::parse(page).unwrap(), false));
        }
        let dev = Url::parse("http://localhost:1420/").unwrap();
        assert!(is_local_page(&dev, true));
        assert!(!is_local_page(&dev, false));
    }

    #[test]
    fn rejects_external_schemes_spoofed_hosts_and_unrelated_loopback_services() {
        for page in [
            "https://example.com/",
            "http://tauri.localhost.example.com/",
            "http://tauri.localhost:9000/",
            "http://localhost:443/",
            "http://127.0.0.1:1421/",
            "http://user@tauri.localhost/",
            "file:///C:/Windows/win.ini",
            "javascript:alert(1)",
            "data:text/html,test",
        ] {
            assert!(!is_local_page(&Url::parse(page).unwrap(), true), "{page}");
        }
    }
}
