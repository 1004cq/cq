package gateway

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/cqim/go-gateway/internal/auth"
	"github.com/cqim/go-gateway/internal/msgservice"
	"github.com/cqim/go-gateway/internal/store"
	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

// ============ WebSocket 客户端 ============

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = 50 * time.Second
	maxMessageSize = 65536 // 64KB
)

// Client 代表一个 WebSocket 连接
type Client struct {
	userID  string
	conn    *websocket.Conn
	send    chan []byte // 发送缓冲区
	gateway *Gateway
}

// writePump 写协程：从 send 通道读取消息并写入 WebSocket
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			// ★ 背压控制：检测缓冲区积压
			if len(c.send) > cap(c.send)*3/4 {
				log.Printf("[Gateway] 用户 %s 发送缓冲区积压，丢弃消息", c.userID)
				continue
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// readPump 读协程：从 WebSocket 读取消息并处理
func (c *Client) readPump() {
	defer func() {
		c.gateway.unregister(c)
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, rawMsg, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[Gateway] 用户 %s WebSocket 异常断开: %v", c.userID, err)
			}
			break
		}

		c.gateway.handleClientMessage(c, rawMsg)
	}
}

// ============ Gateway ============

// Gateway WebSocket 接入层
type Gateway struct {
	upgrader  websocket.Upgrader
	verifier  *auth.Verifier
	store     *store.Store
	msgSvc    *msgservice.Service
	rdb       *redis.Client
	ctx       context.Context

	// 连接管理
	mu          sync.RWMutex
	clients     map[string]*Client // userID -> Client
	groupOnline map[string]map[string]struct{} // groupID -> set<userID>
	groupCount  map[string]int                 // groupID -> 总成员数缓存
}

// New 创建 Gateway
func New(
	verifier *auth.Verifier,
	s *store.Store,
	rdb *redis.Client,
	ctx context.Context,
) *Gateway {
	gw := &Gateway{
		upgrader: websocket.Upgrader{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
			CheckOrigin: func(r *http.Request) bool {
				return true // 允许跨域（生产环境应限制）
			},
		},
		verifier:    verifier,
		store:       s,
		rdb:         rdb,
		ctx:         ctx,
		clients:     make(map[string]*Client),
		groupOnline: make(map[string]map[string]struct{}),
		groupCount:  make(map[string]int),
	}
	return gw
}

// SetMsgService 注入消息服务（解决循环依赖）
func (gw *Gateway) SetMsgService(svc *msgservice.Service) {
	gw.msgSvc = svc
}

// ============ ConnectionManager 接口实现 ============

// PushToUser 推送消息给指定用户
func (gw *Gateway) PushToUser(userID string, serializedMsg []byte) bool {
	gw.mu.RLock()
	client, ok := gw.clients[userID]
	gw.mu.RUnlock()

	if !ok {
		return false
	}

	// 非阻塞写入，避免慢消费者阻塞扇出
	select {
	case client.send <- serializedMsg:
		return true
	default:
		log.Printf("[Gateway] 用户 %s 发送缓冲区已满，丢弃消息", userID)
		return false
	}
}

// GetGroupOnlineMembers 获取群在线成员列表
func (gw *Gateway) GetGroupOnlineMembers(groupID string) []string {
	gw.mu.RLock()
	defer gw.mu.RUnlock()

	members, ok := gw.groupOnline[groupID]
	if !ok {
		return nil
	}

	result := make([]string, 0, len(members))
	for uid := range members {
		result = append(result, uid)
	}
	return result
}

// GetGroupMemberCount 获取群成员总数
func (gw *Gateway) GetGroupMemberCount(groupID string) int {
	gw.mu.RLock()
	count, ok := gw.groupCount[groupID]
	gw.mu.RUnlock()

	if ok {
		return count
	}

	// 从数据库加载
	members, err := gw.store.GetGroupMemberIDs(groupID)
	if err != nil {
		return 0
	}

	gw.mu.Lock()
	gw.groupCount[groupID] = len(members)
	gw.mu.Unlock()

	return len(members)
}

// ============ 连接管理 ============

// register 注册新连接
func (gw *Gateway) register(client *Client) {
	gw.mu.Lock()
	defer gw.mu.Unlock()

	// 如果已有旧连接，关闭它
	if old, ok := gw.clients[client.userID]; ok {
		close(old.send)
	}
	gw.clients[client.userID] = client

	log.Printf("[Gateway] 用户 %s 上线，当前在线: %d", client.userID, len(gw.clients))
}

// unregister 注销连接
func (gw *Gateway) unregister(client *Client) {
	gw.mu.Lock()
	defer gw.mu.Unlock()

	if current, ok := gw.clients[client.userID]; ok && current == client {
		delete(gw.clients, client.userID)
		close(client.send)

		// 从所有群在线列表中移除
		for groupID, members := range gw.groupOnline {
			if _, inGroup := members[client.userID]; inGroup {
				delete(members, client.userID)
				if len(members) == 0 {
					delete(gw.groupOnline, groupID)
				}
				// 更新 Redis 在线状态
				go gw.rdb.SRem(gw.ctx, "group:online:"+groupID, client.userID)
			}
		}

		// 更新 Redis 在线状态
		go gw.rdb.Del(gw.ctx, "user:online:"+client.userID)

		log.Printf("[Gateway] 用户 %s 下线，当前在线: %d", client.userID, len(gw.clients))
	}
}

// joinGroupOnline 将用户加入群在线列表
func (gw *Gateway) joinGroupOnline(groupID, userID string) {
	gw.mu.Lock()
	if _, ok := gw.groupOnline[groupID]; !ok {
		gw.groupOnline[groupID] = make(map[string]struct{})
	}
	gw.groupOnline[groupID][userID] = struct{}{}
	gw.mu.Unlock()

	// 更新 Redis
	gw.rdb.SAdd(gw.ctx, "group:online:"+groupID, userID)
}

// ============ 消息处理 ============

// ClientMessage 客户端发来的消息格式
type ClientMessage struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

// handleClientMessage 处理客户端消息
func (gw *Gateway) handleClientMessage(c *Client, rawMsg []byte) {
	var msg ClientMessage
	if err := json.Unmarshal(rawMsg, &msg); err != nil {
		log.Printf("[Gateway] 解析消息失败: %v", err)
		return
	}

	switch msg.Type {
	case "group_send":
		gw.handleGroupSend(c, msg.Data)
	case "group_join_online":
		gw.handleGroupJoinOnline(c, msg.Data)
	case "group_pull":
		gw.handleGroupPull(c, msg.Data)
	case "group_ack":
		gw.handleGroupAck(c, msg.Data)
	case "ping":
		gw.sendToClient(c, map[string]string{"type": "pong"})
	default:
		log.Printf("[Gateway] 未知消息类型: %s", msg.Type)
	}
}

// handleGroupSend 处理群消息发送
func (gw *Gateway) handleGroupSend(c *Client, data json.RawMessage) {
	var payload msgservice.GroupMessagePayload
	if err := json.Unmarshal(data, &payload); err != nil {
		gw.sendError(c, "invalid payload")
		return
	}

	payload.SenderID = c.userID // 强制使用认证用户 ID，防止伪造

	// 检查是否是群成员
	isMember, err := gw.store.IsGroupMember(payload.GroupID, c.userID)
	if err != nil || !isMember {
		gw.sendError(c, "非群成员")
		return
	}

	result, err := gw.msgSvc.SendGroupMessage(gw.ctx, payload)
	if err != nil {
		gw.sendError(c, err.Error())
		return
	}

	// 向发送方回复 ACK
	gw.sendToClient(c, map[string]any{
		"type":      "group_send_ack",
		"groupId":   payload.GroupID,
		"seq":       result.Seq,
		"timestamp": result.Timestamp,
	})
}

// handleGroupJoinOnline 处理用户加入群在线状态
func (gw *Gateway) handleGroupJoinOnline(c *Client, data json.RawMessage) {
	var req struct {
		GroupIDs []string `json:"groupIds"`
	}
	if err := json.Unmarshal(data, &req); err != nil {
		return
	}

	for _, groupID := range req.GroupIDs {
		// 验证是群成员
		isMember, err := gw.store.IsGroupMember(groupID, c.userID)
		if err != nil || !isMember {
			continue
		}
		gw.joinGroupOnline(groupID, c.userID)
	}
}

// handleGroupPull 处理拉取群历史消息
func (gw *Gateway) handleGroupPull(c *Client, data json.RawMessage) {
	var req struct {
		GroupID   string `json:"groupId"`
		AfterSeq  int64  `json:"afterSeq"`
		BeforeSeq int64  `json:"beforeSeq"`
		Limit     int    `json:"limit"`
	}
	if err := json.Unmarshal(data, &req); err != nil {
		gw.sendError(c, "invalid payload")
		return
	}

	if req.Limit <= 0 || req.Limit > 100 {
		req.Limit = 50
	}

	msgs, hasMore, latestSeq, err := gw.store.PullMessages(
		req.GroupID, c.userID, req.AfterSeq, req.BeforeSeq, req.Limit,
	)
	if err != nil {
		gw.sendError(c, err.Error())
		return
	}

	// 转换消息格式
	result := make([]map[string]any, 0, len(msgs))
	for _, m := range msgs {
		item := map[string]any{
			"id":         m.ID,
			"seq":        m.Seq,
			"senderId":   m.SenderID,
			"senderName": m.SenderName,
			"msgType":    m.MsgType,
			"content":    m.Content,
			"createdAt":  m.CreatedAt.UTC().Format(time.RFC3339Nano),
			"isRevoked":  m.IsRevoked,
		}
		if m.ReplyToID != nil {
			item["replyToId"] = *m.ReplyToID
		}
		if m.Extra != nil {
			var extra map[string]any
			if err := json.Unmarshal([]byte(*m.Extra), &extra); err == nil {
				item["extra"] = extra
			}
		}
		result = append(result, item)
	}

	gw.sendToClient(c, map[string]any{
		"type":      "group_messages",
		"groupId":   req.GroupID,
		"messages":  result,
		"hasMore":   hasMore,
		"latestSeq": latestSeq,
	})
}

// handleGroupAck 处理群消息已读确认
func (gw *Gateway) handleGroupAck(c *Client, data json.RawMessage) {
	var req struct {
		GroupID    string `json:"groupId"`
		LastAckSeq int64  `json:"lastAckSeq"`
	}
	if err := json.Unmarshal(data, &req); err != nil {
		return
	}

	unread, err := gw.store.UpdateAckSeq(req.GroupID, c.userID, req.LastAckSeq)
	if err != nil {
		return
	}

	gw.sendToClient(c, map[string]any{
		"type":    "group_ack_result",
		"groupId": req.GroupID,
		"unread":  unread,
	})
}

// ============ HTTP 处理器 ============

// HandleWS WebSocket 升级处理器
func (gw *Gateway) HandleWS(w http.ResponseWriter, r *http.Request) {
	// 从 query 参数或 Header 获取 Token
	token := r.URL.Query().Get("token")
	if token == "" {
		token = r.Header.Get("Authorization")
		if len(token) > 7 && token[:7] == "Bearer " {
			token = token[7:]
		}
	}

	if token == "" {
		http.Error(w, "missing token", http.StatusUnauthorized)
		return
	}

	userID, err := gw.verifier.Verify(token)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	conn, err := gw.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[Gateway] WebSocket 升级失败: %v", err)
		return
	}

	client := &Client{
		userID:  userID,
		conn:    conn,
		send:    make(chan []byte, 512),
		gateway: gw,
	}

	gw.register(client)

	// 更新 Redis 在线状态
	gw.rdb.Set(gw.ctx, "user:online:"+userID, "1", 10*time.Minute)

	// 自动加入用户所在的所有群的在线列表
	go func() {
		groupIDs, err := gw.store.GetUserGroups(userID)
		if err == nil {
			for _, gid := range groupIDs {
				gw.joinGroupOnline(gid, userID)
			}
		}
	}()

	// 启动读写协程
	go client.writePump()
	client.readPump() // 阻塞直到连接断开
}

// HandleHealth 健康检查
func (gw *Gateway) HandleHealth(w http.ResponseWriter, r *http.Request) {
	gw.mu.RLock()
	onlineCount := len(gw.clients)
	gw.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":  "ok",
		"online":  onlineCount,
		"service": "cqim-go-gateway",
	})
}

// ============ 工具函数 ============

func (gw *Gateway) sendToClient(c *Client, data any) {
	b, err := json.Marshal(data)
	if err != nil {
		return
	}
	select {
	case c.send <- b:
	default:
	}
}

func (gw *Gateway) sendError(c *Client, errMsg string) {
	gw.sendToClient(c, map[string]string{
		"type":  "error",
		"error": errMsg,
	})
}
