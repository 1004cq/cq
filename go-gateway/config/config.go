package config

import (
	"os"
	"strconv"
)

// Config 全局配置
type Config struct {
	// Gateway 配置
	GatewayPort int
	GatewayHost string

	// Redis 配置
	RedisAddr     string
	RedisPassword string
	RedisDB       int

	// 数据库配置（SQLite）
	DBPath string

	// 性能调优
	LargeGroupThreshold  int // 大群阈值（成员数超过此值视为大群）
	LargeGroupConcurrency int // 大群扇出并发数
	SmallGroupConcurrency int // 小群扇出并发数
	FanoutShardSize      int // 扇出分片大小
	MergeWindowMs        int // 消息合并窗口（ms）
	MergeMaxBatch        int // 合并推送最大消息数
	WsBackpressureBytes  int // WebSocket 背压阈值（字节）
	DBBatchSize          int // 批量落库批次大小
	DBFlushIntervalMs    int // 批量落库最大等待时间（ms）
	QueueMaxSize         int // 异步队列最大积压
}

// Load 从环境变量加载配置
func Load() *Config {
	return &Config{
		GatewayPort:          getEnvInt("GATEWAY_PORT", 8081),
		GatewayHost:          getEnv("GATEWAY_HOST", "0.0.0.0"),
		RedisAddr:            getEnv("REDIS_ADDR", "127.0.0.1:6379"),
		RedisPassword:        getEnv("REDIS_PASSWORD", ""),
		RedisDB:              getEnvInt("REDIS_DB", 0),
		DBPath:               getEnv("DB_PATH", "/home/ubuntu/cqim/prisma/dev.db"),
		LargeGroupThreshold:  getEnvInt("LARGE_GROUP_THRESHOLD", 500),
		LargeGroupConcurrency: getEnvInt("LARGE_GROUP_CONCURRENCY", 30),
		SmallGroupConcurrency: getEnvInt("SMALL_GROUP_CONCURRENCY", 200),
		FanoutShardSize:      getEnvInt("FANOUT_SHARD_SIZE", 200),
		MergeWindowMs:        getEnvInt("MERGE_WINDOW_MS", 80),
		MergeMaxBatch:        getEnvInt("MERGE_MAX_BATCH", 20),
		WsBackpressureBytes:  getEnvInt("WS_BACKPRESSURE_BYTES", 65536),
		DBBatchSize:          getEnvInt("DB_BATCH_SIZE", 100),
		DBFlushIntervalMs:    getEnvInt("DB_FLUSH_INTERVAL_MS", 50),
		QueueMaxSize:         getEnvInt("QUEUE_MAX_SIZE", 100000),
	}
}

func getEnv(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

func getEnvInt(key string, defaultVal int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return defaultVal
}
