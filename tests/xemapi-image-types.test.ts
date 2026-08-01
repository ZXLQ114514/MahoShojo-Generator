import { describe, expect, test } from 'vitest';

import { isXemApiImageModel, parseXemApiImageResponse } from '@/lib/tachie/xemapi/types';
import {
  buildXemApiImageRequest,
  generateXemApiImage,
  resolveXemApiImageProvider,
} from '@/lib/tachie/xemapi/provider';

describe('XemAPI image response parsing', () => {
  test('解析 OpenAI 兼容的 URL 图片响应', () => {
    expect(parseXemApiImageResponse({
      created: 1,
      data: [{ url: 'https://cdn.example.test/image.png' }],
    })).toEqual({ imageUrls: ['https://cdn.example.test/image.png'] });
  });

  test('解析 base64 图片并补全 data URL', () => {
    expect(parseXemApiImageResponse({
      data: [{ b64_json: 'abc123', mime_type: 'image/webp' }],
    })).toEqual({ imageUrls: ['data:image/webp;base64,abc123'] });
  });

  test('兼容异步任务 ID并去重图片地址', () => {
    expect(parseXemApiImageResponse({
      task_id: 'task-1',
      data: [
        { url: 'https://cdn.example.test/image.png' },
        { url: 'https://cdn.example.test/image.png' },
      ],
    })).toEqual({
      taskId: 'task-1',
      imageUrls: ['https://cdn.example.test/image.png'],
    });
  });

  test('拒绝空响应和非目标模型', () => {
    expect(parseXemApiImageResponse(null)).toEqual({ imageUrls: [] });
    expect(isXemApiImageModel('gpt-image-2')).toBe(true);
    expect(isXemApiImageModel('gpt-image-1')).toBe(false);
  });

  test('优先选择 XemAPI_default，且不会把密钥放进请求体', async () => {
    const request = buildXemApiImageRequest({ prompt: 'test prompt' });
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'test prompt',
      size: '1024x1024',
      quality: 'standard',
      style: 'vivid',
      n: 1,
      response_format: 'url',
    });
    expect(body).not.toHaveProperty('apiKey');

    const selected = resolveXemApiImageProvider([
      { name: 'XemAPI_vip', apiKey: 'vip-key', baseUrl: 'https://vip.example/v1', model: 'gpt-5.5', type: 'openai' },
      { name: 'XemAPI_default', apiKey: 'default-key', baseUrl: 'https://default.example/v1', model: 'deepseek-v4-pro', type: 'openai' },
    ]);
    expect(selected?.name).toBe('XemAPI_default');
  });

  test('离线模拟 XemAPI 图片生成请求', async () => {
    let calledUrl = '';
    let calledInit: RequestInit | undefined;
    const result = await generateXemApiImage(
      { prompt: 'test prompt', quality: 'high', style: 'natural' },
      [{ name: 'XemAPI_default', apiKey: 'test-key', baseUrl: 'https://xem.example/v1', model: 'text-model', type: 'openai' }],
      async (input, init) => {
        calledUrl = String(input);
        calledInit = init;
        return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.test/generated.png' }] }), { status: 200 });
      },
    );

    expect(calledUrl).toBe('https://xem.example/v1/images/generations');
    expect(new Headers(calledInit?.headers).get('Authorization')).toBe('Bearer test-key');
    expect(JSON.parse(String(calledInit?.body))).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'test prompt',
      quality: 'high',
      style: 'natural',
    });
    expect(result.imageUrls).toEqual(['https://cdn.example.test/generated.png']);
  });

  test('支持本次请求覆盖 API Key，且不写入请求体', async () => {
    let calledInit: RequestInit | undefined;
    await generateXemApiImage(
      { prompt: 'test prompt', apiKey: 'request-only-key' },
      [{ name: 'XemAPI_default', apiKey: 'server-key', baseUrl: 'https://xem.example/v1', model: 'text-model', type: 'openai' }],
      async (_input, init) => {
        calledInit = init;
        return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example.test/generated.png' }] }), { status: 200 });
      },
    );
    expect(new Headers(calledInit?.headers).get('Authorization')).toBe('Bearer request-only-key');
    expect(String(calledInit?.body)).not.toContain('request-only-key');
  });
});
