package msgservice

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/cqim/go-gateway/internal/fanout"
	"github.com/cqim/go-gateway/internal/store"
	"github.com/google/uuid"
)

// GroupMessagePayload 群消息输入
type GroupMessagePayload struct {
	GroupID    string         `json:"groupId"`
	SenderID   string         `json:"senderId"`
	SenderName string         `json:"senderName"`
	MsgType    string         `json:"msgType"`
	Content    string         `json:"content"`
	ReplyToID  string         `json:"replyToId,omitempty"`
	Extra      map[string]any `json:"extra,omitempty"`
}

// PushMessage 推送给客户端的消息格式
type PushMessage struct {
	Type       string         `json:"type"`
	GroupID    string         `json:"groupId"`
	Seq        int64          `json:"seq"`
	SenderID   string         `json:"senderId"`
	SenderName string         `json:"senderName"`
	MsgType    string         `json:"msgType"`
	Content    string         `json:"content"`
	ReplyToID  string         `json:"replyToId,omitempty"`
	Extra      map[string]any `json:"extra,omitempty"`
	Timestamp  int64          `json:"timestamp"`
}

// SendResult 发送结果
type SendResult struct {
	Seq       int64 `json:"seq"`
	Timestamp int64 `json:"timestamp"`
}

// ============ 序列号生成器（原子互斥）============

type seqGenerator struct {
	mu      sync.Mutex
	current int64
	groupID string
	store   *store.Store
	loaded  bool
}

func (g *seqGenerator) next() (int64, error) {
	g.mu.Lock()
	defer g.mu.Unlock()

	if !g.loaded {
		seq, err := g.store.GetGroupLastSeq(g.groupID)
		if err != nil {
			return 0, fmt.Errorf("load seq: %w", err)
		}
		g.current = seq
		g.loaded = true
	}

	g.current++
	return g.current, nil
}

// ============ 批量落库队列 ============

type queueItem struct {
	msg       store.GroupMessage
	pushMsg   PushMessage
	done      chan error
}

type batchQueue struct {
	mu            sync.Mutex
	buckets       map[string][]*queueItem
	flushTimers   map[string]*time.Timer
	totalSize     int64
	maxSize       int64
	batchSize     int
	flushInterval time.Duration
	store         *store.Store
}

func newBatchQueue(store *store.Store, maxSize, batchSize int, flushInterval time.Duration) *batchQueue {
	return &batchQueue{
		buckets:       make(map[string][]*queueItem),
		flushTimers:   make(map[string]*time.Timer),
		maxSize:       int64(maxSize),
		batchSize:     batchSize,
		flushInterval: flushInterval,
		store:         store,
	}
}

func (q *batchQueue) enqueue(item *queueItem) error {
	if atomic.LoadInt64(&q.totalSize) >= q.maxSize {
		return fmt.Errorf("消息队列已满，请稍后重试")
	}

	groupID := item.msg.GroupID

	q.mu.Lock()
	q.buckets[groupID] = append(q.buckets[groupID], item)
	atomic.AddInt64(&q.totalSize, 1)
	size := len(q.buckets[groupID])

	if size >= q.batchSize {
		// 满批次立即刷盘
		batch := q.buckets[groupID]
		q.buckets[groupID] = nil
		if t, ok := q.flushTimers[groupID]; ok {
			t.Stop()
			delete(q.flushTimers, groupID)
		}
		q.mu.Unlock()
		go q.flushBatch(groupID, batch)
	} else if _, ok := q.flushTimers[groupID]; !ok {
		// 设置定时刷盘
		t := time.AfterFunc(q.flushInterval, func() {
			q.mu.Lock()
			batch := q.buckets[groupID]
			q.buckets[groupID] = nil
			delete(q.flushTimers, groupID)
			q.mu.Unlock()
			if len(batch) > 0 {
				go q.flushBatch(groupID, batch)
			}
		})
		q.flushTimers[groupID] = t
		q.mu.Unlock()
	} else {
		q.mu.Unlock()
	}

	return nil
}

func (q *batchQueue) flushBatch(groupID string, batch []*queueItem) {
	atomic.AddInt64(&q.totalSize, -int64(len(batch)))

	msgs := make([]store.GroupMessage, len(batch))
	for i, item := range batch {
		msgs[i] = item.msg
	}

	err := q.store.BatchInsertMessages(msgs)
	for _, item := range batch {
		item.done <- err
	}
}

// ============ Message Service ============

// ConnectionManager 连接管理接口（由 Gateway 实现）
type ConnectionManager interface {
	// PushToUser 推送消息给指定用户（已序列化）
	PushToUser(userID string, serializedMsg []byte) bool
	// GetGroupOnlineMembers 获取群在线成员列表
	GetGroupOnlineMembers(groupID string) []string
	// GetGroupMemberCount 获取群成员总数（用于选择扇出策略）
	GetGroupMemberCount(groupID string) int
}

// Service 消息服务
type Service struct {
	store         *store.Store
	connMgr       ConnectionManager
	fanoutMgr     *fanout.GroupFanoutManager
	seqGens       sync.Map // groupID -> *seqGenerator
	queue         *batchQueue
	shardSize     int
	backpressure  int
}

// Config 消息服务配置
type Config struct {
	LargeGroupThreshold   int
	LargeGroupConcurrency int
	SmallGroupConcurrency int
	FanoutShardSize       int
	DBBatchSize           int
	DBFlushIntervalMs     int
	QueueMaxSize          int
	BackpressureBytes     int
}

// New 创建消息服务
func New(s *store.Store, connMgr ConnectionManager, cfg Config) *Service {
	return &Service{
		store:     s,
		connMgr:   connMgr,
		fanoutMgr: fanout.NewGroupFanoutManager(cfg.LargeGroupThreshold, cfg.LargeGroupConcurrency, cfg.SmallGroupConcurrency),
		queue: newBatchQueue(
			s,
			cfg.QueueMaxSize,
			cfg.DBBatchSize,
			time.Duration(cfg.DBFlushIntervalMs)*time.Millisecond,
		),
		shardSize:    cfg.FanoutShardSize,
		backpressure: cfg.BackpressureBytes,
	}
}

// getSeqGen 获取或创建群序列号生成器
func (svc *Service) getSeqGen(groupID string) *seqGenerator {
	v, _ := svc.seqGens.LoadOrStore(groupID, &seqGenerator{
		groupID: groupID,
		store:   svc.store,
	})
	return v.(*seqGenerator)
}

// SendGroupMessage 发送群消息（快速路径，异步落库和推送）
func (svc *Service) SendGroupMessage(ctx context.Context, payload GroupMessagePayload) (*SendResult, error) {
	// 1. 生成序列号
	gen := svc.getSeqGen(payload.GroupID)
	seq, err := gen.next()
	if err != nil {
		return nil, fmt.Errorf("generate seq: %w", err)
	}

	timestamp := time.Now().UnixMilli()
	msgID := uuid.New().String()

	if payload.MsgType == "" {
		payload.MsgType = "text"
	}
	if payload.SenderName == "" {
		payload.SenderName = payload.SenderID
	}

	var replyToID *string
	if payload.ReplyToID != "" {
		replyToID = &payload.ReplyToID
	}

	var extraStr *string
	if payload.Extra != nil {
		b, _ := json.Marshal(payload.Extra)
		s := string(b)
		extraStr = &s
	}

	// 2. 构造推送消息
	pushMsg := PushMessage{
		Type:       "group_message",
		GroupID:    payload.GroupID,
		Seq:        seq,
		SenderID:   payload.SenderID,
		SenderName: payload.SenderName,
		MsgType:    payload.MsgType,
		Content:    payload.Content,
		ReplyToID:  payload.ReplyToID,
		Extra:      payload.Extra,
		Timestamp:  timestamp,
	}

	// 3. 异步落库（不阻塞发送方）
	dbMsg := store.GroupMessage{
		ID:         msgID,
		GroupID:    payload.GroupID,
		Seq:        seq,
		SenderID:   payload.SenderID,
		SenderName: payload.SenderName,
		MsgType:    payload.MsgType,
		Content:    payload.Content,
		ReplyToID:  replyToID,
		Extra:      extraStr,
		CreatedAt:  time.UnixMilli(timestamp),
	}

	done := make(chan error, 1)
	item := &queueItem{msg: dbMsg, pushMsg: pushMsg, done: done}

	if err := svc.queue.enqueue(item); err != nil {
		return nil, err
	}

	// 4. 异步扇出推送（不等待落库完成）
	go func() {
		// 等待落库完成后再推送（保证消息可拉取）
		if err := <-done; err != nil {
			log.Printf("[MsgService] 落库失败: groupId=%s seq=%d err=%v", payload.GroupID, seq, err)
			return
		}
		svc.fanoutToGroup(payload.GroupID, pushMsg, payload.SenderID)
	}()

	// 5. 立即返回 ACK（快速路径，<10ms）
	return &SendResult{Seq: seq, Timestamp: timestamp}, nil
}

// fanoutToGroup 分片扇出推送
func (svc *Service) fanoutToGroup(groupID string, msg PushMessage, excludeUserID string) {
	onlineMembers := svc.connMgr.GetGroupOnlineMembers(groupID)
	if len(onlineMembers) == 0 {
		return
	}

	memberCount := svc.connMgr.GetGroupMemberCount(groupID)
	pool := svc.fanoutMgr.GetPool(memberCount)

	// ★ 预序列化：同一条消息只 JSON.stringify 一次
	serializedMsg, err := json.Marshal(msg)
	if err != nil {
		log.Printf("[MsgService] 序列化消息失败: %v", err)
		return
	}

	// 过滤发送者
	targets := make([]string, 0, len(onlineMembers))
	for _, uid := range onlineMembers {
		if uid != excludeUserID {
			targets = append(targets, uid)
		}
	}

	if len(targets) == 0 {
		return
	}

	// ★ 分片推送：将目标成员按 shardSize 分片
	shards := make([][]string, 0)
	for i := 0; i < len(targets); i += svc.shardSize {
		end := i + svc.shardSize
		if end > len(targets) {
			end = len(targets)
		}
		shards = append(shards, targets[i:end])
	}

	// 提交分片任务给 Worker 池
	tasks := make([]fanout.Task, len(shards))
	for i, shard := range shards {
		s := shard
		sm := serializedMsg
		tasks[i] = func() {
			for _, uid := range s {
				svc.connMgr.PushToUser(uid, sm)
			}
		}
	}

	pool.SubmitAndWait(tasks)

	if len(onlineMembers) > 100 {
		log.Printf("[MsgService] 扇出完成: groupId=%s online=%d pushed=%d shards=%d",
			groupID, len(onlineMembers), len(targets), len(shards))
	}
}
