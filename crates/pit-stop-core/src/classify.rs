use crate::Operation;

/// Conservative lexical recognition. No expansion, execution, shell interpretation or output inspection.
pub fn classify(tool: &str, command: Option<&str>) -> Operation {
    let name = tool.to_ascii_lowercase();
    match name.as_str() {
        "read" | "readfile" | "read_file" | "grep" | "glob" | "ls" | "codesearch" | "websearch"
        | "webfetch" => Operation::Inspect,
        "write" | "writefile" | "write_file" | "edit" | "multiedit" | "apply_patch" | "delete"
        | "strreplace" => Operation::Edit,
        "task" | "agent" | "delegate" => Operation::Delegate,
        "bash" | "shell" | "powershell" | "terminal" | "run_terminal_cmd" => {
            command.map(classify_command).unwrap_or(Operation::Shell)
        }
        _ if name.starts_with("mcp__") || name.starts_with("mcp:") || name == "mcp" => {
            Operation::Mcp
        }
        _ => Operation::Other,
    }
}

pub fn classify_command(command: &str) -> Operation {
    // Wrappers, chains, redirects, quoted/escaped tokens and substitution stay generic.
    if command.len() > 16_384 || command.chars().any(|c| ";&|<>\n\r`$(){}\\\"'".contains(c)) {
        return Operation::Shell;
    }
    let words: Vec<_> = command.split_ascii_whitespace().collect();
    if words
        .iter()
        .any(|word| matches!(*word, "--help" | "-h" | "--version" | "--no-run"))
    {
        return Operation::Shell;
    }
    match words.as_slice() {
        ["cargo", "test", ..]
        | ["pytest", ..]
        | ["pytest.exe", ..]
        | ["vitest", ..]
        | ["jest", ..]
        | ["python", "-m", "pytest", ..]
        | ["python3", "-m", "pytest", ..]
        | ["dotnet", "test", ..]
        | ["go", "test", ..]
        | ["gradle" | "gradlew" | "./gradlew" | "gradlew.bat", "test", ..]
        | ["mvn", "test", ..] => Operation::Test,
        ["cargo", "build", ..]
        | ["dotnet", "build", ..]
        | ["go", "build", ..]
        | ["gradle" | "gradlew" | "./gradlew" | "gradlew.bat", "build" | "assemble", ..]
        | ["mvn", "package" | "compile", ..] => Operation::Build,
        ["npm" | "pnpm" | "yarn" | "bun", "test", ..]
        | ["npm" | "pnpm" | "yarn" | "bun", "run", "test", ..] => Operation::Test,
        ["npm" | "pnpm" | "yarn" | "bun", "build", ..]
        | ["npm" | "pnpm" | "yarn" | "bun", "run", "build", ..] => Operation::Build,
        _ => Operation::Shell,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn conservative_commands() {
        assert_eq!(classify("MCP:github_search", None), Operation::Mcp);
        assert_eq!(classify("mcp__github__search", None), Operation::Mcp);
        for cmd in [
            "cargo test --workspace",
            "pnpm test",
            "python -m pytest -q",
            "dotnet test",
            "go test ./...",
            "gradle test",
            "mvn test",
            "./gradlew test",
        ] {
            assert_eq!(classify_command(cmd), Operation::Test, "{cmd}");
        }
        for cmd in [
            "cargo build --release",
            "npm run build",
            "go build ./...",
            "mvn package",
            "mvn compile",
            "gradle build",
        ] {
            assert_eq!(classify_command(cmd), Operation::Build, "{cmd}");
        }
        for cmd in [
            "echo cargo test",
            "cat test.log",
            "cargo test && echo done",
            "pwsh -Command cargo test",
            "npm run test:unknown",
            "env X=y cargo test",
            "pytest; false",
            "cargo test $(secret)",
            "C:\\cargo.exe test",
            "bash -c 'cargo test'",
        ] {
            assert_eq!(classify_command(cmd), Operation::Shell, "{cmd}");
        }
    }
}
