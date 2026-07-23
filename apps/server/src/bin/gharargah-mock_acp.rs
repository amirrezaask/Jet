use clap::Parser;
use jet_server::mock_acp;

#[tokio::main]
async fn main() {
    let args = mock_acp::cli::Args::parse();
    if let Err(error) = mock_acp::run(args).await {
        eprintln!("gharargah-mock-acp: {error:#}");
        std::process::exit(1);
    }
}
