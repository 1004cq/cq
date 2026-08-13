set -a
source /home/ubuntu/cqim/go-gateway/.env
set +a
exec /home/ubuntu/cqim/go-gateway/bin/cqim-gateway
