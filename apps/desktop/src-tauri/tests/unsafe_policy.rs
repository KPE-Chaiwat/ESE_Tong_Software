//! The workspace unsafe-code policy (root `Cargo.toml`, `[workspace.lints]`; REV-008 m-4),
//! checked mechanically on the sources:
//! - every crate inherits the workspace lints (`unsafe_code = "forbid"`), except
//!   `esefact-desktop`, which denies `unsafe_code` and `clippy::undocumented_unsafe_blocks`;
//! - unsafe code and `allow(unsafe_code)` appear only in the allowed modules of
//!   `esefact-desktop` ([`ALLOWED`]): one `#[allow(unsafe_code)]` directly on `mod win`, and
//!   every `unsafe` keyword of that file inside that module.
//!
//! Comments, string and char literals are ignored, so documentation may talk about unsafe
//! code. To allow another module, the PM must accept it first; then add it to [`ALLOWED`]
//! and to the note in the root `Cargo.toml`.

use std::fs;
use std::path::{Path, PathBuf};

/// (file relative to the workspace root, module that may contain unsafe code).
const ALLOWED: &[(&str, &str)] = &[
    ("apps/desktop/src-tauri/src/key_menu.rs", "win"),
    ("apps/desktop/src-tauri/src/os_timer.rs", "win"),
];

/// Directories scanned for `.rs` files and `Cargo.toml` manifests.
const SCANNED: &[&str] = &["crates", "apps/desktop/src-tauri"];

/// Directories never scanned (build output, generated code, dependencies).
const SKIPPED: &[&str] = &["target", "gen", "node_modules", ".git"];

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("workspace root")
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if path.is_dir() {
            if !SKIPPED.contains(&name.as_str()) {
                collect(&path, out);
            }
        } else if name.ends_with(".rs") || name == "Cargo.toml" {
            out.push(path);
        }
    }
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// The code of a Rust source with comments, string literals and char literals replaced by
/// spaces (newlines kept), so that only real tokens remain.
fn strip(src: &str) -> String {
    let c: Vec<char> = src.chars().collect();
    let mut out = String::with_capacity(src.len());
    let mut i = 0;
    let blank = |out: &mut String, ch: char| out.push(if ch == '\n' { '\n' } else { ' ' });
    while i < c.len() {
        let next = c.get(i + 1).copied();
        if c[i] == '/' && next == Some('/') {
            while i < c.len() && c[i] != '\n' {
                out.push(' ');
                i += 1;
            }
        } else if c[i] == '/' && next == Some('*') {
            let mut depth = 0usize;
            while i < c.len() {
                if c[i] == '/' && c.get(i + 1) == Some(&'*') {
                    depth += 1;
                    out.push_str("  ");
                    i += 2;
                } else if c[i] == '*' && c.get(i + 1) == Some(&'/') {
                    depth -= 1;
                    out.push_str("  ");
                    i += 2;
                    if depth == 0 {
                        break;
                    }
                } else {
                    blank(&mut out, c[i]);
                    i += 1;
                }
            }
        } else if c[i] == 'r'
            && (next == Some('"') || next == Some('#'))
            && !(i > 0 && (c[i - 1].is_alphanumeric() || c[i - 1] == '_'))
        {
            // Raw string r"..." / r#"..."#.
            let mut j = i + 1;
            let mut hashes = 0;
            while c.get(j) == Some(&'#') {
                hashes += 1;
                j += 1;
            }
            if c.get(j) != Some(&'"') {
                out.push(c[i]);
                i += 1;
                continue;
            }
            j += 1;
            while j < c.len() {
                if c[j] == '"' && (1..=hashes).all(|k| c.get(j + k) == Some(&'#')) {
                    j += 1 + hashes;
                    break;
                }
                j += 1;
            }
            for &ch in &c[i..j.min(c.len())] {
                blank(&mut out, ch);
            }
            i = j;
        } else if c[i] == '"' {
            let mut j = i + 1;
            while j < c.len() && c[j] != '"' {
                j += if c[j] == '\\' { 2 } else { 1 };
            }
            let end = (j + 1).min(c.len());
            for &ch in &c[i..end] {
                blank(&mut out, ch);
            }
            i = end;
        } else if c[i] == '\'' {
            // A char literal ('x', '\n', '\u{..}') or a lifetime ('a).
            let end = if next == Some('\\') {
                let mut j = i + 2;
                while j < c.len() && c[j] != '\'' {
                    j += 1;
                }
                Some(j + 1)
            } else if c.get(i + 2) == Some(&'\'') {
                Some(i + 3)
            } else {
                None
            };
            match end {
                Some(end) => {
                    let end = end.min(c.len());
                    for &ch in &c[i..end] {
                        blank(&mut out, ch);
                    }
                    i = end;
                }
                None => {
                    out.push(c[i]);
                    i += 1;
                }
            }
        } else {
            out.push(c[i]);
            i += 1;
        }
    }
    out
}

/// Byte offsets of the identifier `word` in stripped code.
fn tokens(code: &str, word: &str) -> Vec<usize> {
    let ident = |ch: char| ch.is_alphanumeric() || ch == '_';
    code.match_indices(word)
        .filter(|(at, _)| {
            let before = code[..*at].chars().next_back();
            let after = code[at + word.len()..].chars().next();
            !before.is_some_and(ident) && !after.is_some_and(ident)
        })
        .map(|(at, _)| at)
        .collect()
}

fn line_of(code: &str, at: usize) -> usize {
    code[..at].matches('\n').count() + 1
}

/// The violations of one source file (`allowed_module`: the module that may contain
/// unsafe code, when the file is in [`ALLOWED`]).
fn violations(path: &str, src: &str, allowed_module: Option<&str>) -> Vec<String> {
    let code = strip(src);
    let unsafe_at = tokens(&code, "unsafe");
    let allow_at = tokens(&code, "unsafe_code");
    let mut found = Vec::new();
    let Some(module) = allowed_module else {
        for at in unsafe_at {
            found.push(format!(
                "{path}:{}: `unsafe` outside the allowed modules",
                line_of(&code, at)
            ));
        }
        for at in allow_at {
            found.push(format!(
                "{path}:{}: an `unsafe_code` lint attribute outside the allowed modules",
                line_of(&code, at)
            ));
        }
        return found;
    };
    // Exactly one `#[allow(unsafe_code)]`, directly on `mod <module> {`.
    let range = match allow_at.as_slice() {
        [at] => {
            let attr_start = code[..*at].rfind("#[").unwrap_or(*at);
            let attr = code[attr_start..].split(']').next().unwrap_or_default();
            let compact: String = attr.chars().filter(|ch| !ch.is_whitespace()).collect();
            let after = code[*at..].find(']').map_or(code.len(), |e| *at + e + 1);
            let rest = code[after..].trim_start();
            let head = format!("mod {module}");
            if compact != "#[allow(unsafe_code)" || !rest.starts_with(&head) {
                found.push(format!(
                    "{path}:{}: `#[allow(unsafe_code)]` must sit directly on `mod {module}`",
                    line_of(&code, *at)
                ));
                None
            } else {
                let open = after + code[after..].find('{').unwrap_or(0);
                let mut depth = 0i64;
                let mut close = code.len();
                for (k, ch) in code[open..].char_indices() {
                    match ch {
                        '{' => depth += 1,
                        '}' => {
                            depth -= 1;
                            if depth == 0 {
                                close = open + k;
                                break;
                            }
                        }
                        _ => {}
                    }
                }
                Some((attr_start, close))
            }
        }
        [] => None,
        more => {
            for at in more {
                found.push(format!(
                    "{path}:{}: more than one `unsafe_code` lint attribute",
                    line_of(&code, *at)
                ));
            }
            None
        }
    };
    for at in unsafe_at {
        if !range.is_some_and(|(start, end)| at > start && at < end) {
            found.push(format!(
                "{path}:{}: `unsafe` outside `mod {module}`",
                line_of(&code, at)
            ));
        }
    }
    found
}

/// The lint violations of one manifest.
fn manifest_violations(path: &str, toml: &str) -> Vec<String> {
    let squeezed: String = toml
        .lines()
        .map(|l| l.split('#').next().unwrap_or_default().trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if path == "apps/desktop/src-tauri/Cargo.toml" {
        let mut found = Vec::new();
        for needle in [
            "unsafe_code = \"deny\"",
            "undocumented_unsafe_blocks = \"deny\"",
        ] {
            if !squeezed.contains(needle) {
                found.push(format!("{path}: missing `{needle}`"));
            }
        }
        return found;
    }
    if squeezed.contains("[lints]\nworkspace = true") {
        Vec::new()
    } else {
        vec![format!(
            "{path}: must inherit the workspace lints (`[lints]` / `workspace = true`)"
        )]
    }
}

#[test]
fn unsafe_code_only_in_the_allowed_modules() {
    let root = workspace_root();
    let workspace = fs::read_to_string(root.join("Cargo.toml")).expect("root Cargo.toml");
    assert!(
        workspace.contains("[workspace.lints.rust]\nunsafe_code = \"forbid\"")
            || workspace.contains("[workspace.lints.rust]\r\nunsafe_code = \"forbid\""),
        "the workspace must forbid unsafe code"
    );
    let mut files = Vec::new();
    for dir in SCANNED {
        collect(&root.join(dir), &mut files);
    }
    let mut found = Vec::new();
    let mut seen_allowed = Vec::new();
    let mut sources = 0;
    for file in &files {
        let rel = relative(&root, file);
        let text = fs::read_to_string(file).unwrap_or_default();
        if rel.ends_with("Cargo.toml") {
            found.extend(manifest_violations(&rel, &text));
            continue;
        }
        sources += 1;
        let module = ALLOWED.iter().find(|(f, _)| *f == rel).map(|(_, m)| *m);
        if module.is_some() {
            seen_allowed.push(rel.clone());
        }
        found.extend(violations(&rel, &text, module));
    }
    assert!(sources > 50, "the scan found only {sources} Rust files");
    for (f, _) in ALLOWED {
        assert!(
            seen_allowed.iter().any(|s| s == f),
            "allowed file {f} not found (moved? update ALLOWED)"
        );
    }
    assert!(
        found.is_empty(),
        "unsafe-code policy violated (see the note at [workspace.lints] in the root \
         Cargo.toml; only {ALLOWED:?} may contain unsafe code):\n{}",
        found.join("\n")
    );
}

#[test]
fn the_scanner_ignores_comments_and_literals_and_finds_real_tokens() {
    let src = concat!(
        "// unsafe in a comment\n",
        "/* unsafe /* nested */ unsafe */\n",
        "const A: &str = \"unsafe { }\";\n",
        "const B: &str = r#\"unsafe \"quoted\" \"#;\n",
        "const C: char = '\"';\n",
        "fn f<'a>(x: &'a u8) -> u8 { *x }\n",
        "fn not_unsafe_named() {}\n",
    );
    assert!(violations("x.rs", src, None).is_empty(), "{src}");
    let bad = format!("{src}fn g() {{ {} {{ }} }}\n", "unsafe");
    let v = violations("x.rs", &bad, None);
    assert_eq!(v, ["x.rs:8: `unsafe` outside the allowed modules"]);
    let attr = format!("#[allow({}_code)]\nfn h() {{}}\n", "unsafe");
    assert_eq!(violations("x.rs", &attr, None).len(), 1);
}

#[test]
fn allowed_files_keep_unsafe_inside_their_module() {
    let kw = "unsafe";
    let good = format!(
        "fn safe() {{}}\n#[cfg(windows)]\n#[allow({kw}_code)]\nmod win {{\n    fn f() {{ {kw} {{ g() }} }}\n}}\n"
    );
    assert!(violations("a.rs", &good, Some("win")).is_empty());
    let outside = format!("{good}fn later() {{ {kw} {{ }} }}\n");
    assert_eq!(
        violations("a.rs", &outside, Some("win")),
        ["a.rs:7: `unsafe` outside `mod win`"]
    );
    let wrong_module = good.replace("mod win", "mod other");
    assert!(!violations("a.rs", &wrong_module, Some("win")).is_empty());
    let twice = format!("{good}#[allow({kw}_code)]\nmod win2 {{}}\n");
    assert!(!violations("a.rs", &twice, Some("win")).is_empty());
}

#[test]
fn manifests_must_inherit_the_workspace_lints() {
    assert!(manifest_violations("crates/x/Cargo.toml", "[lints]\nworkspace = true\n").is_empty());
    assert_eq!(
        manifest_violations(
            "crates/x/Cargo.toml",
            "[lints.rust]\nunsafe_code = \"deny\"\n"
        )
        .len(),
        1
    );
    assert_eq!(
        manifest_violations("apps/desktop/src-tauri/Cargo.toml", "[lints.rust]\n").len(),
        2
    );
}
