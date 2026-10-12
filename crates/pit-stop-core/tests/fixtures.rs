use pit_stop_core::{normalize, Source};
#[test]
fn recorded_contract_shapes_are_redacted() {
    for (source, fixture) in [
        (
            Source::Claude,
            include_str!("../../../fixtures/claude/pre-tool-use.json"),
        ),
        (
            Source::Claude,
            include_str!("../../../fixtures/claude/post-tool-use.json"),
        ),
        (
            Source::Claude,
            include_str!("../../../fixtures/claude/post-tool-use-failure.json"),
        ),
        (
            Source::Cursor,
            include_str!("../../../fixtures/cursor/pre-tool-use.json"),
        ),
        (
            Source::Cursor,
            include_str!("../../../fixtures/cursor/post-tool-use.json"),
        ),
        (
            Source::Cursor,
            include_str!("../../../fixtures/cursor/post-tool-use-failure.json"),
        ),
        (
            Source::Codex,
            include_str!("../../../fixtures/codex/turn-complete.json"),
        ),
    ] {
        let input = serde_json::from_str(fixture).unwrap();
        let event = normalize(source, None, &input, &[1; 32]).unwrap();
        event.validate().unwrap();
        let serialized = serde_json::to_string(&event).unwrap();
        assert!(!serialized.contains("DO_NOT_FORWARD"));
        assert!(!serialized.contains("private"));
        assert!(serialized.len() < 1024);
    }
}
