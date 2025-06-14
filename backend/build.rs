fn main() {
    // Tell cargo to rerun build script if models change
    println!("cargo:rerun-if-changed=src/models/");
}
