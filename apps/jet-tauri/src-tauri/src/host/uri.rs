use std::path::{Path, PathBuf};

pub fn path_to_file_uri(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    if normalized.starts_with('/') {
        format!("file://{normalized}")
    } else {
        format!("file:///{normalized}")
    }
}

pub fn file_uri_to_path(uri: &str) -> String {
    if !uri.starts_with("file://") {
        return uri.to_string();
    }
    let mut path = percent_decode_path(&uri[7..]);
    if path.len() >= 3 && path.as_bytes().get(0) == Some(&b'/') {
        let chars: Vec<char> = path.chars().collect();
        if chars.len() >= 3 && chars[1].is_ascii_alphabetic() && chars[2] == ':' {
            path = path[1..].to_string();
        }
    }
    path
}

fn percent_decode_path(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&input[i + 1..i + 3], 16) {
                out.push(byte as char);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

pub fn resolve_path(base: &Path, raw: &str) -> PathBuf {
    let p = Path::new(raw);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        base.join(p)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_roundtrip() {
        let path = "/tmp/foo/bar.ts";
        let uri = path_to_file_uri(path);
        assert_eq!(file_uri_to_path(&uri), path);
    }
}
