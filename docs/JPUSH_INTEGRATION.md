# 极光 JPush SDK 集成指南（imimchat / Capacitor）

## 已完成的代码集成

- npm 包：`capacitor-plugin-jpush@4`（Capacitor 8）
- 配置：`capacitor.config.ts` → `plugins.JPush`
- 客户端：`client/src/hooks/useJPush.ts`（AppContext 已挂载）
- 服务端：`server/jpush.ts`（registration 上报 + REST 推送）

## 极光控制台（已完成）

| 项 | 值 |
|----|-----|
| AppKey | `2f496988f16573ad08321835` |
| Bundle ID | `com.imim.chat` |
| Key ID | `URP8X87T38` |
| Team ID | `4U332QFN6D` |
| 鉴权方式 | Token Authentication (.p8) |

## Mac 本地构建步骤

```bash
cd cqim-app
pnpm install
npm run build
npx cap add ios      # 首次
npx cap add android  # 可选
npx cap sync
```

### iOS（必须）

1. 用 Xcode 打开 `ios/App/App.xcworkspace`
2. **Signing & Capabilities** 添加：
   - Push Notifications
   - Background Modes → Remote notifications
3. 在 `AppDelegate.swift` 中加入（`npx cap sync` 后合并，勿覆盖 Capacitor 原有逻辑）：

```swift
func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
  NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
}

func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
  NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
}

func application(_ application: UIApplication,
                 didReceiveRemoteNotification userInfo: [AnyHashable: Any],
                 fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
  NotificationCenter.default.post(name: Notification.Name(rawValue: "didReceiveRemoteNotification"), object: userInfo)
  completionHandler(.newData)
}

func applicationDidBecomeActive(_ application: UIApplication) {
  NotificationCenter.default.post(name: Notification.Name(rawValue: "didBecomeActiveNotification"), object: nil)
}
```

4. Xcode 中找到 `JPUSHService.h` → Target Membership 勾选 **CapacitorPluginJPush** 并设为 **Public**（插件 README 要求）
5. 真机运行，控制台应出现 `registrationID: ...`

### Android（可选）

- `variables.gradle` 中 `compileSdkVersion` / `targetSdkVersion` ≥ 33
- Android 13+ 需通知权限（`useJPush` 已自动申请）

## 服务端环境变量

```env
JPUSH_APP_KEY=2f496988f16573ad08321835
JPUSH_MASTER_SECRET=你的极光MasterSecret
```

Master Secret 在极光控制台 → 应用设置 → 查看。

## 验证

1. 真机登录 App
2. 服务端日志：`[JPush] 用户 xxx 注册 ios registrationId=...`
3. 极光控制台 → 发送通知 → 填入 registrationID 测试
4. 或配置 `JPUSH_MASTER_SECRET` 后由服务端离线消息自动走 JPush 通道

## 推送优先级

离线消息：**自建 APNs** → **JPush** → 个推 → FCM
