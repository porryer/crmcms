# 第三方前端依赖

| 文件 | 来源 | 许可证 | 用途 |
|---|---|---|---|
| `dingtalk-lite.js` | npm `dingtalk-jsapi@3.2.9`（仅 `core` 与 `api/runtime/permission/requestAuthCode`） | MIT | 钉钉客户端内免登，仅在钉钉 UA 下按需加载 |

重新生成：

```bash
mkdir /tmp/ddjs && cd /tmp/ddjs && npm init -y && npm i dingtalk-jsapi@3.2.9 esbuild@0.24.0
cat > entry.js <<'JS'
var core = require('dingtalk-jsapi/core');
var requestAuthCode = require('dingtalk-jsapi/api/runtime/permission/requestAuthCode').default;
window.ddLite = { env: core.env, ready: core.ready, error: core.error, requestAuthCode: requestAuthCode };
JS
npx esbuild entry.js --bundle --minify --format=iife --target=es2017 --outfile=dingtalk-lite.js
```

产物不含 `eval` / `new Function`，可在 `script-src 'self'` 的 CSP 下运行。
