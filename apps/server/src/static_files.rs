use axum::body::Body;
use axum::http::{header, Response, StatusCode, Uri};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
// Build and test pipelines generate this directory before compiling the binary.
#[folder = "../gharargah/dist"]
pub struct FrontendAssets;

pub async fn serve(uri: Uri) -> Response<Body> {
    let requested = uri.path().trim_start_matches('/');
    let asset_name = if requested.is_empty() {
        "index.html"
    } else {
        requested
    };
    if let Some(asset) = FrontendAssets::get(asset_name) {
        return asset_response(asset_name, asset.data.into_owned());
    }
    if requested.starts_with("api/") || requested.starts_with("ws") || requested.contains('.') {
        return Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::empty())
            .unwrap();
    }
    match FrontendAssets::get("index.html") {
        Some(index) => asset_response("index.html", index.data.into_owned()),
        None => Response::builder()
            .status(StatusCode::SERVICE_UNAVAILABLE)
            .body(Body::from("Jet frontend assets are missing"))
            .unwrap(),
    }
}

fn asset_response(name: &str, bytes: Vec<u8>) -> Response<Body> {
    let mime = mime_guess::from_path(name).first_or_octet_stream();
    let cache = if name == "index.html" {
        "no-cache"
    } else if name.starts_with("assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "public, max-age=3600"
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime.as_ref())
        .header(header::CACHE_CONTROL, cache)
        .header("x-content-type-options", "nosniff")
        .body(Body::from(bytes))
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn unknown_api_does_not_receive_spa_fallback() {
        let response = serve("/api/missing".parse().unwrap()).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn browser_route_receives_index_without_cache() {
        let response = serve("/projects/example".parse().unwrap()).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-cache");
    }
}
