#[tokio::main]
async fn main() {
    if let Err(error) = jet_server::run().await {
        eprintln!("Jet failed to start: {error:#}");
        std::process::exit(1);
    }
}
