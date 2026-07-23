use super::bounds::MAX_ALLOWED_ROOTS;
use super::types::AcpError;
use std::path::{Path, PathBuf};

pub fn canonicalize_absolute(path: &Path) -> Result<PathBuf, AcpError> {
    if !path.is_absolute() {
        return Err(AcpError::InvalidPath {
            path: path.to_path_buf(),
            reason: "absolute path required".to_string(),
        });
    }
    std::fs::canonicalize(path).map_err(|error| AcpError::Io {
        operation: "canonicalize path",
        message: error.to_string(),
    })
}

pub fn canonicalize_roots(roots: &[PathBuf]) -> Result<Vec<PathBuf>, AcpError> {
    if roots.len() > MAX_ALLOWED_ROOTS {
        return Err(AcpError::InvalidPath {
            path: PathBuf::new(),
            reason: format!("at most {MAX_ALLOWED_ROOTS} allowed roots"),
        });
    }
    roots
        .iter()
        .map(|root| canonicalize_absolute(root))
        .collect()
}

pub fn canonicalize_under_roots(path: &Path, roots: &[PathBuf]) -> Result<PathBuf, AcpError> {
    let canonical_path = canonicalize_absolute(path)?;
    let canonical_roots = canonicalize_roots(roots)?;
    if canonical_roots
        .iter()
        .any(|root| canonical_path.starts_with(root))
    {
        Ok(canonical_path)
    } else {
        Err(AcpError::PathOutsideAllowedRoots {
            path: canonical_path,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn rejects_relative_path() {
        let error =
            canonicalize_absolute(Path::new("relative")).expect_err("relative paths must fail");
        assert!(matches!(error, AcpError::InvalidPath { .. }));
    }

    #[test]
    fn rejects_paths_outside_roots() {
        let root = tempdir().expect("temp root");
        let outside = tempdir().expect("temp outside");
        let error = canonicalize_under_roots(outside.path(), &[root.path().to_path_buf()])
            .expect_err("outside");
        assert!(matches!(error, AcpError::PathOutsideAllowedRoots { .. }));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape_after_canonicalization() {
        use std::os::unix::fs::symlink;
        let root = tempdir().expect("temp root");
        let outside = tempdir().expect("temp outside");
        let link = root.path().join("escape");
        symlink(outside.path(), &link).expect("symlink");
        fs::write(outside.path().join("secret"), "secret").expect("write");
        let error = canonicalize_under_roots(&link.join("secret"), &[root.path().to_path_buf()])
            .expect_err("escape");
        assert!(matches!(error, AcpError::PathOutsideAllowedRoots { .. }));
    }
}
