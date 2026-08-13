FROM golang:1.22-alpine AS builder
ENV GOPROXY=https://goproxy.cn,direct
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go mod tidy && CGO_ENABLED=0 GOOS=linux go build -o cqim-gateway ./cmd/main.go

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
ENV TZ=Asia/Shanghai
WORKDIR /app
COPY --from=builder /app/cqim-gateway .
EXPOSE 8081
CMD ["./cqim-gateway"]
