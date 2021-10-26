set -ex
export NETWORK=kovan-ovm-futures 

# WS
# until node src/ run -p wss://ws-kovan.optimism.io --from-block 0 -n 1; do
#     echo "Keeper exited with exit code $?.  Respawning.." >&2
#     sleep 15
# done

# HTTPS
until node src/ run -p https://optimism-kovan.infura.io/v3/8b1cbf82d4004d63acd4aa9829bc6d15 --from-block 0 -n 1; do
    echo "Keeper exited with exit code $?.  Respawning.." >&2
    sleep 15
done