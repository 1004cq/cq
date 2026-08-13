/**
 * DoveIM WebRTC 模拟层
 * 模拟信令系统、ICE 候选交换、媒体流管理
 */

export interface SignalMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'hangup';
  from: string;
  to: string;
  payload: any;
}

export interface CallSession {
  callId: string;
  peerId: string;
  callType: 'audio' | 'video';
  status: 'idle' | 'offering' | 'answering' | 'connected' | 'ended';
  startTime?: number;
  endTime?: number;
}

class WebRTCManager {
  private currentSession: CallSession | null = null;
  private onStatusChange: ((session: CallSession | null) => void) | null = null;

  setOnStatusChange(cb: (session: CallSession | null) => void) {
    this.onStatusChange = cb;
  }

  // 发起通话
  initiateCall(peerId: string, callType: 'audio' | 'video'): CallSession {
    this.currentSession = {
      callId: `call-${Date.now()}`,
      peerId,
      callType,
      status: 'offering',
    };

    console.log(`[DoveIM RTC] 发起${callType === 'audio' ? '语音' : '视频'}通话 → ${peerId}`);

    // 模拟信令流程
    setTimeout(() => {
      if (this.currentSession?.status === 'offering') {
        this.currentSession.status = 'connected';
        this.currentSession.startTime = Date.now();
        this.onStatusChange?.(this.currentSession);
        console.log('[DoveIM RTC] 通话已接通（模拟）');
      }
    }, 3000);

    this.onStatusChange?.(this.currentSession);
    return this.currentSession;
  }

  // 接听来电
  answerCall(): void {
    if (this.currentSession?.status === 'answering') {
      this.currentSession.status = 'connected';
      this.currentSession.startTime = Date.now();
      this.onStatusChange?.(this.currentSession);
    }
  }

  // 挂断
  hangup(): void {
    if (this.currentSession) {
      this.currentSession.status = 'ended';
      this.currentSession.endTime = Date.now();
      this.onStatusChange?.(this.currentSession);
      console.log('[DoveIM RTC] 通话已结束');
      this.currentSession = null;
    }
  }

  // 模拟来电
  simulateIncomingCall(peerId: string, callType: 'audio' | 'video'): CallSession {
    this.currentSession = {
      callId: `call-${Date.now()}`,
      peerId,
      callType,
      status: 'answering',
    };
    this.onStatusChange?.(this.currentSession);
    return this.currentSession;
  }

  getCurrentSession(): CallSession | null {
    return this.currentSession;
  }
}

export const rtcManager = new WebRTCManager();
