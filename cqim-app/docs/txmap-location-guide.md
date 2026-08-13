# 腾讯地图位置共享开发指南

## 核心 API

### 逆地理编码（坐标→地址）
- URL: `https://apis.map.qq.com/ws/geocoder/v1/?location=lat,lng&key=KEY`
- 后端代理调用，避免 Key 泄露

### 正向地理编码（地址→坐标）
- URL: `https://apis.map.qq.com/ws/geocoder/v1/?address=地址&key=KEY`

### 静态地图缩略图
- URL: `https://apis.map.qq.com/ws/staticmap/v2/?center=lat,lng&zoom=17&size=600*300&markers=size:large|color:red|label:A|lat,lng&key=KEY`

## 注意事项
- 坐标系：GCJ-02（火星坐标）
- Web 端需 HTTPS + 用户授权定位
- WebService API 需后端代理（避免 Key 泄露和跨域）
- JS API Key 需在控制台设置 referer 白名单
