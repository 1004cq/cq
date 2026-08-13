/**
 * DoveIM WebSocket 模拟层
 * 模拟实时消息推送、在线状态、打字指示器等
 */

type MessageHandler = (data: any) => void;

interface WSEvent {
  type: 'message' | 'typing' | 'online' | 'offline' | 'call_signal';
  payload: any;
}

class MockWebSocket {
  private handlers: Map<string, MessageHandler[]> = new Map();
  private connected: boolean = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect() {
    // 模拟连接延迟
    setTimeout(() => {
      this.connected = true;
      this.emit('connected', { timestamp: Date.now() });
      console.log('[DoveIM WS] 连接已建立（模拟）');
    }, 500);
  }

  disconnect() {
    this.connected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.emit('disconnected', {});
  }

  on(event: string, handler: MessageHandler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(handler);
  }

  off(event: string, handler: MessageHandler) {
    const handlers = this.handlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) handlers.splice(index, 1);
    }
  }

  private emit(event: string, data: any) {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.forEach(h => h(data));
    }
  }

  // 模拟发送消息
  send(event: WSEvent) {
    if (!this.connected) {
      console.warn('[DoveIM WS] 未连接，消息发送失败');
      return;
    }
    // 模拟服务器确认
    setTimeout(() => {
      this.emit('ack', { eventId: Date.now(), type: event.type });
    }, 100);
  }

  // 模拟接收消息（外部调用触发）
  simulateReceive(event: WSEvent) {
    this.emit(event.type, event.payload);
  }

  isConnected() {
    return this.connected;
  }
}

// 单例
export const ws = new MockWebSocket();
