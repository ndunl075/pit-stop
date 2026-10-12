//! Print an installer-generated dry-run configuration without applying it.
use std::path::Path;
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    assert_eq!(
        args.len(),
        3,
        "usage: preview SOURCE CONFIG_PATH HELPER_PATH"
    );
    let result =
        pit_stop_integrations::preview(&args[0], Path::new(&args[1]), Path::new(&args[2]), false)
            .expect("preview failed");
    print!("{}", result.after);
}
