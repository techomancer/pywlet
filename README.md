# 🐍 Pywlet — Local Python & Pygame Learning IDE

**Pywlet** is an offline-first, browser-based Python and Pygame coding environment built for young learners (designed for an 11-year-old learning Python and game development).

Unlike standard AI coding tools that write or autocomplete code for the user, Pywlet pairs a real code editor (**Monaco Editor**) and an interactive **Pygame Canvas Stage** with a **Socratic Local AI Tutor** (running 100% locally via **Transformers.js WebGPU/WASM** or **Chrome's Built-in Prompt API / Gemma 4**) that **explains concepts, translates errors, and asks guiding questions—never spoiling or generating solution code**.

---

## ✨ Key Features

- **🦉 Socratic Local AI Tutor (No Code Generation):**
  - Highlight any Python/Pygame keyword, click **`💡 Explain Under Cursor / Selection`** (or right-click → *Ask Pywlet Tutor*, `Ctrl+E`), or ask questions in the chat panel.
  - Multi-layer pedagogical guardrail prevents the model from outputting copy-pasteable multi-line code blocks.
  - Modular LLM backend selector supporting:
    1. **Transformers.js (Qwen2.5-Coder Local)** via WebGPU (with automatic multi-threaded SIMD WASM fallback and browser Cache Storage persistence).
    2. **Chrome Prompt API (Built-in Gemma 4 / Gemini Nano)** via `self.LanguageModel` / `window.ai`.
    3. **Local Server (Ollama / `llama.cpp`)** on `localhost:11434`.
- **🐞 Instant Beginner Python & Pygame Coach:**
  - Zero-latency static analysis highlights common beginner pitfalls as you type—before even running the code:
    - Single `=` instead of `==` inside an `if` or `while` condition
    - Missing colon `:` at the end of `if`, `for`, `while`, `def`, `else`
    - Missing indentation after a `:` block
    - Unbalanced parentheses `( )`
    - Forgetting `pygame.display.flip()` inside the game loop
    - Calling `screen.fill()` *after* drawing shapes (which paints over the frame!)
- **🎮 Interactive 60 FPS Pygame Stage & Starter Projects:**
  - Built-in 400×280 HTML5 Canvas Stage with live mouse `(x, y)` coordinate readout and keyboard focus handling.
  - Includes starter templates (*Bouncing Ball*, *Star Catcher*, *Python Playground*), click-to-insert sprite/sound paths, and visual cheatsheets (Coordinates, RGB Colors, Keyboard Keys, Game Loop).
- **🔍 Live AI & WebGPU Debug Inspector:**
  - Built-in telemetry panel showing active hardware WebGPU adapter info (automatically detecting and bypassing software `google / swiftshader`), prefill latency (`ms`), live token streaming speed (`tok/s`), and the exact prompt sent.

---

## 🌐 Required Chrome Flags (WebGPU & Built-in Gemma 4 AI)

To unlock hardware **WebGPU** acceleration (especially on Linux with AMD/Intel/NVIDIA GPUs) and Chrome's **Built-in AI (Prompt API + Gemma 4)** without needing command-line startup flags, copy and paste each URL below into Chrome's address bar, set it to **Enabled**, and click **Relaunch**:

*(You can also view this list anytime inside the IDE by clicking the **`❓ Flags Help`** button next to the AI selector!)*

### 1. Hardware WebGPU Acceleration
| Flag Name | Chrome Flag URL (Copy & Paste) | Setting | Purpose |
| :--- | :--- | :--- | :--- |
| **Override software rendering list** | `chrome://flags/#ignore-gpu-blocklist` | **Enabled** | Overrides Chrome's built-in software rendering list and prevents fallback to `google / swiftshader`. |
| **Vulkan** | `chrome://flags/#enable-vulkan` | **Enabled** | Uses Vulkan as the graphics backend (required by Chrome's Dawn WebGPU engine on Linux). |
| **Force enable WebGPU interop** | `chrome://flags/#force-enable-webgpu-interop` | **Enabled** | Forces WebGPU on Vulkan via GL compositing interop on Linux. |
| **Unsafe WebGPU Support** | `chrome://flags/#enable-unsafe-webgpu` | **Enabled** | Enables best-effort WebGPU support across desktop configurations. |

### 2. Chrome Built-in AI (Prompt API & Gemma 4)
| Flag Name | Chrome Flag URL (Copy & Paste) | Setting | Purpose |
| :--- | :--- | :--- | :--- |
| **Prompt API** | `chrome://flags/#prompt-api` | **Enabled** | Enables the built-in `LanguageModel` Prompt API for natural language instructions. |
| **Gemma 4 for Built-in AI** | `chrome://flags/#gemma4-for-built-in-ai` | **Enabled** | Enables Chrome's built-in AI APIs (Prompt, Summarizer, Writer, etc.) to use the on-device **Gemma 4** model. |

> **💡 Tip — Checking On-Device Model Download Status:**
> After relaunching Chrome with `#prompt-api` and `#gemma4-for-built-in-ai` enabled, open **`chrome://on-device-internals`** (or **`chrome://components`** → *Optimization Guide On Device Model*) to watch Chrome download and activate the built-in model weights.

---

## 🚀 Development & Local Deployment

Pywlet is built with **Vanilla TypeScript** and **Vite**. You can run and build it with **Bun** (or Node.js / `npm`).

### 1. Install Dependencies
```bash
bun install
```

### 2. Run the Local Development Server
```bash
bun run dev
```
Open **`http://localhost:5173`** in Chrome.

### 3. Build & Deploy as a Static Web App
```bash
bun run build
```
This compiles TypeScript and bundles the entire IDE (including Monaco Editor workers and local ONNX Runtime WebAssembly binaries) into the `dist/` folder.

To preview or serve the production build locally with Cross-Origin Isolation headers (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`, which enable multi-threaded `SharedArrayBuffer` execution):
```bash
bun run preview
```
Or serve `dist/` from any static web server (Nginx, Caddy, Apache, Cloudflare Pages, GitHub Pages, or a local Python/Bun static server).

---

## 📂 Project Architecture

- [docs/DESIGN.md](docs/DESIGN.md) — Full architectural design and pedagogical roadmap.
- [index.html](index.html) & [src/style.css](src/style.css) — 3-column IDE layout, Pygame Canvas stage, AI Debug Inspector, and Chrome Flags help drawer.
- [src/editor/monaco-setup.ts](src/editor/monaco-setup.ts) — Monaco Editor controller, marker squiggles, and *"Ask Pywlet Tutor"* context action (`Ctrl+E`).
- [src/diagnostics/python-coach.ts](src/diagnostics/python-coach.ts) — Real-time static analyzer for beginner Python syntax and Pygame loop mistakes.
- [src/runtime/python-runtime.ts](src/runtime/python-runtime.ts) — In-browser Pygame HTML5 Canvas runner & Pyodide WASM bridge.
- [src/llm/](src/llm/) — Modular `LLMBackend` architecture:
  - [src/llm/tutor-service.ts](src/llm/tutor-service.ts) — Orchestrates instant concept cards, backend switching, and Socratic prompting.
  - [src/llm/guardrail.ts](src/llm/guardrail.ts) — Socratic context builder (focused cursor window) and multi-line code-block stripping guardrail.
  - [src/llm/backends/transformers-backend.ts](src/llm/backends/transformers-backend.ts) & [src/llm/workers/transformers.worker.ts](src/llm/workers/transformers.worker.ts) — Web Worker running `@huggingface/transformers` on WebGPU/WASM.
  - [src/llm/backends/chrome-prompt-backend.ts](src/llm/backends/chrome-prompt-backend.ts) — Chrome Built-in Prompt API (`LanguageModel` / Gemma 4 / Gemini Nano) adapter.
  - [src/llm/backends/ollama-backend.ts](src/llm/backends/ollama-backend.ts) — Local Ollama / `llama.cpp` server adapter.
