// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { modelIdsByOutput, normalizeModelList } from "../web/src/lib/model-catalog";
import { ImagePanel } from "../web/src/panels/ImagePanel";
import { VideoPanel } from "../web/src/panels/VideoPanel";

describe("capability model selection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("filters output capabilities, preserves aliases and deduplicates exact ids", () => {
    const models = normalizeModelList({
      data: [
        { id: "text-model", capabilities: { input: ["text"], output: ["text"], tools: true } },
        { id: "image-alias", capabilities: { input: ["text"], output: ["image"], tools: false } },
        { id: "gpt-image-2", capabilities: { input: ["text", "image"], output: ["image"], tools: false } },
        { id: "image-alias", capabilities: { input: ["text"], output: ["image"], tools: false } },
        { id: "video-alias", capabilities: { input: ["text"], output: ["video"], tools: false } },
        { id: "legacy-model" }
      ]
    });

    expect(modelIdsByOutput(models, "image")).toEqual(["image-alias", "gpt-image-2"]);
    expect(modelIdsByOutput(models, "video")).toEqual(["video-alias"]);
    expect(models.find((model) => model.id === "legacy-model")?.capabilities).toBeUndefined();
  });

  it("shows only image models and submits the selected alias", async () => {
    let submittedModel: string | undefined;
    const catalogAuthorizations: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (path === "/v1/models") {
        catalogAuthorizations.push((init?.headers as Record<string, string>).authorization);
        return Response.json({
          data: [
            { id: "text-model", capabilities: { input: ["text"], output: ["text"], tools: true } },
            { id: "gpt-image-2", capabilities: { input: ["text"], output: ["image"], tools: false } },
            { id: "image-short", capabilities: { input: ["text"], output: ["image"], tools: false } },
            { id: "image-short", capabilities: { input: ["text"], output: ["image"], tools: false } },
            { id: "video-model", capabilities: { input: ["text"], output: ["video"], tools: false } },
            { id: "legacy-model" }
          ]
        });
      }
      if (path === "/api/images/generations" && init?.method === "POST") {
        submittedModel = JSON.parse(String(init.body)).model;
        return Response.json({ data: [{ url: "https://cdn.test/model-image.png" }] });
      }
      return Response.json({ error: { message: `unexpected path ${path}` } }, { status: 404 });
    }));

    const { rerender } = render(<ImagePanel apiKey="sk-local" />);

    await waitFor(() => expect(screen.queryByText("正在加载可用模型")).not.toBeInTheDocument());
    expect(screen.getByLabelText("模型").closest(".ant-select")).toHaveTextContent("gpt-image-2");
    fireEvent.mouseDown(screen.getByLabelText("模型"));
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["gpt-image-2", "image-short"]);
    expect(screen.queryByRole("option", { name: "text-model" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "video-model" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "image-short" }));

    fireEvent.change(screen.getByLabelText("图片提示词"), { target: { value: "一只纸雕蓝鲸" } });
    fireEvent.click(screen.getByRole("button", { name: "开始生成" }));

    await screen.findByAltText("生成图片 1");
    expect(submittedModel).toBe("image-short");
    expect(screen.getAllByText("image-short").length).toBeGreaterThanOrEqual(1);

    rerender(<ImagePanel apiKey="sk-next" />);
    await waitFor(() => expect(catalogAuthorizations).toEqual(["Bearer sk-local", "Bearer sk-next"]));
    expect(screen.getByLabelText("模型").closest(".ant-select")).toHaveTextContent("image-short");
  });

  it("selects the first video model when the default is unavailable", async () => {
    let submittedModel: string | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      if (path === "/v1/models") {
        return Response.json({
          data: [
            { id: "text-model", capabilities: { input: ["text"], output: ["text"], tools: true } },
            { id: "seedance-short", capabilities: { input: ["text", "image"], output: ["video"], tools: false } },
            { id: "seedance-other", capabilities: { input: ["text"], output: ["video"], tools: false } },
            { id: "image-model", capabilities: { input: ["text"], output: ["image"], tools: false } }
          ]
        });
      }
      if (path === "/api/video/generations" && init?.method === "POST") {
        submittedModel = JSON.parse(String(init.body)).model;
        return Response.json({ data: { task_id: "task_model", status: "running" } });
      }
      if (path === "/api/video/generations/task_model") {
        return Response.json({ id: "task_model", status: "succeeded", videoUrl: "https://cdn.test/model-video.mp4" });
      }
      return Response.json({ error: { message: `unexpected path ${path}` } }, { status: 404 });
    }));

    render(<VideoPanel apiKey="sk-local" />);

    await waitFor(() => expect(screen.getByLabelText("模型").closest(".ant-select")).toHaveTextContent("seedance-short"));
    fireEvent.mouseDown(screen.getByLabelText("模型"));
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["seedance-short", "seedance-other"]);
    fireEvent.click(screen.getByRole("option", { name: "seedance-other" }));
    fireEvent.change(screen.getByLabelText("任务描述"), { target: { value: "固定镜头下的云层延时" } });
    fireEvent.click(screen.getByRole("button", { name: "创建视频任务" }));

    await screen.findByText("task_model");
    expect(submittedModel).toBe("seedance-other");
  });

  it("falls back to the image default when the model catalog fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(
      { error: { message: "catalog unavailable" } },
      { status: 503 }
    )));

    render(<ImagePanel apiKey="sk-local" />);

    expect(await screen.findByText("模型列表加载失败，已使用默认模型")).toBeInTheDocument();
    expect(screen.getByLabelText("模型").closest(".ant-select")).toHaveTextContent("gpt-image-2");
    expect(screen.getByRole("button", { name: "开始生成" })).toBeEnabled();
  });

  it("disables video generation when no compatible model exists", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      data: [
        { id: "text-model", capabilities: { input: ["text"], output: ["text"], tools: true } },
        { id: "image-model", capabilities: { input: ["text"], output: ["image"], tools: false } },
        { id: "legacy-model" }
      ]
    })));

    render(<VideoPanel apiKey="sk-local" />);

    expect(await screen.findByText("当前没有支持该功能的模型")).toBeInTheDocument();
    expect(screen.getByLabelText("模型")).toBeDisabled();
    expect(screen.getByRole("button", { name: "创建视频任务" })).toBeDisabled();
  });
});
