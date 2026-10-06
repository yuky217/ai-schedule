const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite web 端依赖 wa-sqlite.wasm，需让 Metro 将 .wasm 识别为资源
config.resolver.assetExts.push('wasm');

// 开发服务器需带 COOP/COEP 响应头，SharedArrayBuffer 才能
// 用于 SQLite 的 OPFS 同句柄线程（expo-sqlite web 必需）
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    middleware(req, res, next);
  };
};

module.exports = config;
