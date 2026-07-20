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
    Ok(FileStat {
        uri: uri.to_string(),
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
