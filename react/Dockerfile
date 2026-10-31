# 第一階段：Node 建置環境
FROM node:20-alpine AS builder

WORKDIR /app

# 複製依賴描述檔並安裝
COPY package*.json ./
RUN npm ci

# 複製前端原始碼並執行 Vite 建置
COPY . .
RUN npm run build

# 第二階段：Nginx 輕量執行環境
FROM nginx:alpine

# 複製編譯產物至 Nginx 網站根目錄
COPY --from=builder /app/dist /usr/share/nginx/html

# 複製專屬反向代理設定檔
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 暴露 HTTP 連接埠
EXPOSE 80

# 啟動 Nginx
CMD ["nginx", "-g", "daemon off;"]

