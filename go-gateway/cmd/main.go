package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/cqim/go-gateway/config"
	"github.com/cqim/go-gateway/internal/auth"
	"github.com/cqim/go-gateway/internal/gateway"
	"github.com/cqim/go-gateway/internal/msgservice"
	"github.com/cqim/go-gateway/internal/store"
	"github.com/redis/go-redis/v9"

)

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("[Main] cqim Go Gateway 启动中...")

	// 加载配置
	cfg := config.Load()

	// 初始化上下文
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 初始化 Redis
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})
	if err := rdb.Ping(ctx).Err(); err != nil {
		log.Fatalf("[Main] Redis 连接失败: %v", err)
	}
	log.Printf("[Main] Redis 连接成功: %s", cfg.RedisAddr)

	// 初始化数据库
	s, err := store.New(cfg.DBPath)
	if err != nil {
		log.Fatalf("[Main] 数据库连接失败: %v", err)
	}
	defer s.Close()
	log.Printf("[Main] SQLite 数据库连接成功: %s", cfg.DBPath)

	// 初始化 Session 验证器
	verifier, err := auth.NewVerifier(cfg.DBPath)
	if err != nil {
		log.Fatalf("[Main] Session 验证器初始化失败: %v", err)
	}
	defer verifier.Close()

	// 初始化 Gateway
	gw := gateway.New(verifier, s, rdb, ctx)

	// 初始化消息服务
	msgSvc := msgservice.New(s, gw, msgservice.Config{
		LargeGroupThreshold:   cfg.LargeGroupThreshold,
		LargeGroupConcurrency: cfg.LargeGroupConcurrency,
		SmallGroupConcurrency: cfg.SmallGroupConcurrency,
		FanoutShardSize:       cfg.FanoutShardSize,
		DBBatchSize:           cfg.DBBatchSize,
		DBFlushIntervalMs:     cfg.DBFlushIntervalMs,
		QueueMaxSize:          cfg.QueueMaxSize,
		BackpressureBytes:     cfg.WsBackpressureBytes,
	})

	// 注入消息服务到 Gateway（解决循环依赖）
	gw.SetMsgService(msgSvc)

	// 注册 HTTP 路由
	mux := http.NewServeMux()
	mux.HandleFunc("/ws/group", gw.HandleWS)
	mux.HandleFunc("/health", gw.HandleHealth)

	// 启动 HTTP 服务器
	addr := fmt.Sprintf("%s:%d", cfg.GatewayHost, cfg.GatewayPort)
	server := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// 优雅关闭
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("[Main] Go Gateway 监听在 ws://%s/ws/group", addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[Main] HTTP 服务器启动失败: %v", err)
		}
	}()

	<-sigCh
	log.Println("[Main] 收到关闭信号，正在优雅关闭...")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("[Main] 服务器关闭失败: %v", err)
	}

	log.Println("[Main] Go Gateway 已关闭")
}
