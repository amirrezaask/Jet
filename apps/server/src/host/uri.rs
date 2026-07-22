use std::path::{Path, PathBuf};
use url::Url;

pub fn path_to_file_uri(path: &str) -> String {
    Url::from_file_path(path)
        .map(|url| url.to_string())
        .unwrap_or_else(|_| path.to_string())
}

pub fn file_uri_to_path(uri: &str) -> String {
    Url::parse(uri)
        .ok()
        .filter(|url| url.scheme() == "file")
        .and_then(|url| url.to_file_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| uri.to_string())
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

    #[test]
    fn path_roundtrip_preserves_unicode_and_reserved_characters() {
        let path = "/tmp/Gharargah files/سلام #100%.ts";
        let uri = path_to_file_uri(path);
        assert!(uri.contains("Gharargah%20files"));
        assert!(uri.contains("%23"));
        assert_eq!(file_uri_to_path(&uri), path);
    }
}
