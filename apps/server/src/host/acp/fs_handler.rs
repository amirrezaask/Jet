use super::path_security::canonicalize_under_roots;
use super::types::AcpError;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct FsHandler {
    root: PathBuf,
}

impl FsHandler {
    pub fn new(root: impl Into<PathBuf>) -> Result<Self, AcpError> {
        let root = root.into();
        let root = canonicalize_under_roots(&root, std::slice::from_ref(&root))?;
        Ok(Self { root })
    }

    fn resolve(&self, path: &Path, write: bool) -> Result<PathBuf, AcpError> {
        if !write || path.exists() {
            return canonicalize_under_roots(path, std::slice::from_ref(&self.root));
        }
        let parent = path.parent().ok_or_else(|| AcpError::InvalidPath {
            path: path.to_path_buf(),
            reason: "file path has no parent".to_string(),
        })?;
        let canonical_parent = canonicalize_under_roots(parent, std::slice::from_ref(&self.root))?;
        Ok(
            canonical_parent.join(path.file_name().ok_or_else(|| AcpError::InvalidPath {
                path: path.to_path_buf(),
                reason: "file path has no name".to_string(),
            })?),
        )
    }

    pub fn read_text_file(&self, path: &Path) -> Result<String, AcpError> {
        std::fs::read_to_string(self.resolve(path, false)?).map_err(|error| AcpError::Io {
            operation: "read text file",
            message: error.to_string(),
        })
    }

    pub fn write_text_file(&self, path: &Path, content: &str) -> Result<(), AcpError> {
        std::fs::write(self.resolve(path, true)?, content).map_err(|error| AcpError::Io {
            operation: "write text file",
            message: error.to_string(),
        })
    }
}
