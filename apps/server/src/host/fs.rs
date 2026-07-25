use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::Path;

use super::uri::{file_uri_to_path, path_to_file_uri};

#[derive(Serialize)]
pub struct DirEntry {
    pub uri: String,
    pub name: String,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
}

#[derive(Serialize)]
pub struct FileStat {
    pub uri: String,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
    pub size: u64,
}

pub fn read_file(uri: &str) -> Result<String, String> {
    let path = file_uri_to_path(uri);
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

pub fn write_file(uri: &str, content: &str) -> Result<(), String> {
    let path = file_uri_to_path(uri);
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// Persist a browser File blob (base64) under the OS temp dir; return absolute path.
/// Needed because Chromium strips Finder absolute paths on http(s) pages.
pub fn write_temp_drop(name: &str, content_base64: &str) -> Result<String, String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(content_base64)
        .map_err(|e| format!("invalid drop payload: {e}"))?;
    let dir = std::env::temp_dir().join("gharargah-drops");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = Path::new(name)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "drop.bin".into())
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let path = dir.join(format!("{}-{}", uuid::Uuid::new_v4(), safe));
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

pub fn read_dir(uri: &str) -> Result<Vec<DirEntry>, String> {
    let dir_path = file_uri_to_path(uri);
    let read = fs::read_dir(&dir_path).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    for entry in read {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        entries.push(DirEntry {
            uri: path_to_file_uri(&path.to_string_lossy()),
            name,
            is_directory: file_type.is_dir(),
        });
    }
    Ok(entries)
}

pub fn stat(uri: &str) -> Result<FileStat, String> {
    let path = file_uri_to_path(uri);
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let canonical = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    Ok(FileStat {
        uri: path_to_file_uri(&canonical.to_string_lossy()),
        is_directory: meta.is_dir(),
        size: meta.len(),
    })
}

pub fn handle(channel: &str, args: &[Value]) -> Result<Value, String> {
    match channel {
        "fs:readFile" => {
            let uri = args.first().and_then(|v| v.as_str()).ok_or("missing uri")?;
            Ok(Value::String(read_file(uri)?))
        }
        "fs:writeFile" => {
            let uri = args.first().and_then(|v| v.as_str()).ok_or("missing uri")?;
            let content = args.get(1).and_then(|v| v.as_str()).unwrap_or("");
            write_file(uri, content)?;
            Ok(Value::Null)
        }
        "fs:writeTempDrop" => {
            let name = args.first().and_then(|v| v.as_str()).unwrap_or("drop.bin");
            let content_base64 = args.get(1).and_then(|v| v.as_str()).ok_or("missing content")?;
            Ok(Value::String(write_temp_drop(name, content_base64)?))
        }
        "fs:readDir" => {
            let uri = args.first().and_then(|v| v.as_str()).ok_or("missing uri")?;
            Ok(serde_json::to_value(read_dir(uri)?).map_err(|e| e.to_string())?)
        }
        "fs:stat" => {
            let uri = args.first().and_then(|v| v.as_str()).ok_or("missing uri")?;
            Ok(serde_json::to_value(stat(uri)?).map_err(|e| e.to_string())?)
        }
        _ => Err(format!("unknown fs channel: {channel}")),
    }
}

#[cfg(test)]
mod tests {
    use super::write_temp_drop;
    use base64::Engine as _;

    #[test]
    fn write_temp_drop_round_trips_bytes() {
        let payload = base64::engine::general_purpose::STANDARD.encode(b"hello-drop");
        let path = write_temp_drop("note.txt", &payload).expect("write");
        let body = std::fs::read_to_string(&path).expect("read");
        assert_eq!(body, "hello-drop");
        assert!(path.contains("gharargah-drops"));
        let _ = std::fs::remove_file(path);
    }
}
