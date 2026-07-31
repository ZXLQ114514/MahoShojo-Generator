import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

import { buildStaticBrowserSecurityHeaders } from "./lib/security/browser-headers";

const createNextConfig = (phase: string): NextConfig => {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    initOpenNextCloudflareForDev();
  }

  const staticSecurityHeaders = buildStaticBrowserSecurityHeaders({
    allowGoogleAnalytics: Boolean(process.env.NEXT_PUBLIC_GA_ID?.trim()),
    allowTurnstile: true,
    enableHttpsOnlyHeaders: process.env.MAHOSHOJO_ENABLE_HTTPS_SECURITY_HEADERS !== 'false',
    isProduction: process.env.NODE_ENV === 'production',
  });

  return {
    // 图片优化配置（Cloudflare Workers 不支持默认的图片优化）
    images: {
      unoptimized: true
    },

    // 当前项目页面与类型检查规模较大；单 worker 可避免 Windows 构建时多个
    // TypeScript/Next worker 同时申请内存导致原生 ArrayBuffer 分配失败。
    experimental: {
      cpus: 1,
      workerThreads: false,
      memoryBasedWorkersCount: false,
    },

    // 重定向配置 - 将无效的路径重定向到正确的页面
    async redirects() {
      return [
        {
          source: '/battle-stream',
          destination: '/arena-stream',
          permanent: false,
        },
        {
          source: '/magic-tavern',
          destination: '/magic-tea-party',
          permanent: true,
        },
        {
          source: '/details/:path+',
          destination: '/details',
          permanent: false, // 使用 307 临时重定向
        },
      ];
    },

    async headers() {
      return [
        {
          source: '/:path*',
          headers: staticSecurityHeaders,
        },
        {
          source: '/api/:path*',
          headers: [
            {
              key: 'X-Robots-Tag',
              value: 'noindex',
            },
          ],
        },
      ];
    },

    eslint: {
      // 默认仍在构建时执行 lint；低内存部署可显式设置 NEXT_IGNORE_ESLINT_ERRORS=true，
      // 并单独运行 pnpm lint 完成检查。
      ignoreDuringBuilds: process.env.NEXT_IGNORE_ESLINT_ERRORS === 'true',
    },

    // 其他配置
    typescript: {
      // 默认严格检查；低内存部署可显式设置 NEXT_IGNORE_BUILD_ERRORS=true，
      // 避免 Next 的类型检查 worker 额外占用大量内存。
      ignoreBuildErrors: process.env.NEXT_IGNORE_BUILD_ERRORS === 'true',
    },
  };
};

export default createNextConfig;
