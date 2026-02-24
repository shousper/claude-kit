use std::env;
use std::fs;

fn read_config() -> String {
    let path = env::var("CONFIG_PATH").unwrap();
    fs::read_to_string(path).unwrap()
}

fn main() {
    let config = read_config();
    println!("Config: {}", config);
}
