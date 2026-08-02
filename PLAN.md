# System Specification & AI Agent Development Blueprint

This document outlines the product requirements, system architecture, and technology stack for building a **Multi-LLM Adaptive AI Chat Android Application** and its corresponding **Backend & Admin Management Console**.

---

## Architecture Overview

```
[ Android Client ] ──(HTTPS / SSE)──> [ Backend Proxy & Admin Panel ] ──> [ Upstream LLM Provider APIs ]
 (Adaptive UI)                         (New API / Auth / Token Routing)     (OpenAI, Gemini, DeepSeek, etc.)

```

---

## Part 1: Android Client Application Specification

### 1.1 Core Requirements & Features

#### A. Adaptive Dynamic UI System (Model-Driven UI)

The client application must dynamically adapt its visual theme, icons, color palette, and layout elements based on the currently selected LLM provider.

| Provider / Mode | Visual Style & Theme | Signature UI Components | Special Layout Requirements |
| --- | --- | --- | --- |
| **ChatGPT Mode** | Minimalist monochromatic theme (Dark/Light), neutral tones, clean rounded bubbles. | Standard model selector dropdown, floating action buttons. | Classic sidebar drawer for chat session management. |
| **Gemini Mode** | Material 3 (Material You) expressive layout, subtle pastel gradients, high-radius pill surfaces. | Gemini Sparkle icon animations, floating capsule input bar. | Embedded media/attachment action buttons inside the input bar. |
| **DeepSeek Mode** | Cyber-tech dark theme, cool blue/emerald accents, high-density typography. | **Collapsible Reasoning/Thought Block** (`<think>` card). | Dedicated time counter for reasoning duration, Markdown code-block emphasis. |

#### B. Streaming Chat Engine & SSE Resilience

* **Real-time Streaming**: Must render responses character-by-character or chunk-by-chunk using Server-Sent Events (SSE).
* **Incomplete Markdown Protection**: The parser must gracefully handle incomplete Markdown tags (e.g., unclosed ```code blocks or `bold` markers) during active streaming without breaking UI layout or causing rendering crashes.
* **DeepSeek Reasoning Parser**: Must dynamically parse reasoning streams (either via `delta.reasoning_content` or `<think>...</think>` tags) and separate thought processes from the final answer into a dedicated UI card.

#### C. Session & Memory Management

* **Local Persistence**: Store chat sessions, user prompts, system instructions, and message histories locally.
* **Context Window Sliding**: Support sliding-window context truncation or manual context length limits before dispatching requests to upstream endpoints.

---

### 1.2 Android Technical Stack

* **Language**: Kotlin (Latest Stable)
* **UI Framework**: Jetpack Compose (Declarative UI) with Material Design 3 (Material You)
* **Architecture Pattern**: Unidirectional Data Flow (UDF) via Clean Architecture (MVVM / MVI pattern)
* **Async & Reactive Streams**: Kotlin Coroutines + StateFlow / SharedFlow
* **Networking Layer**: Ktor Client or OkHttp 4.x with `okhttp-sse` extension
* **Markdown & Code Renderer**: Compose-native Markdown parser with syntax highlighting support
* **Local Database**: Room Persistence Library with SQLCipher (optional encryption for local DB)
* **Dependency Injection**: Hilt / Koin

---

## Part 2: Backend & Admin Management Console

### 2.1 Core Requirements & Features

#### A. Upstream API Proxy & Relay Management

* **OpenAI-Compatible Interface**: Expose a unified `/v1/chat/completions` REST and SSE endpoint for the Android client.
* **Upstream Key Pooling & Failover**: Manage multiple upstream API Keys (OpenAI, Google Gemini, DeepSeek, Claude) with load balancing and automatic failover.
* **Model Mapping & Routing**: Map custom client model aliases to actual provider model strings.

#### B. User & Access Administration

* **User Account Management**: Create, suspend, and configure user accounts (Admin vs. Standard User roles).
* **Token Quotas & Rate Limiting**: Set daily/monthly token limits, request per minute (RPM) caps, and credit allocations per user or API key.
* **API Key Management**: Allow administrators to issue, revoke, or restrict client access keys.

#### C. Analytics & Observability Dashboard

* **Real-Time Usage Monitoring**: Track token consumption (prompt vs. completion), call counts, average latency, and cost estimation charts.
* **Live Connection Inspector**: View active SSE streaming connections and system health metrics.

#### D. Dynamic Client Remote Configuration

* **Remote Config Endpoint**: Serve a JSON endpoint supplying active model lists, default system prompts, feature flags, and UI metadata to the mobile app.

---

### 2.2 Backend & Admin Panel Technical Stack

* **Backend Runtime & API Gateway**: Go (Fiber / Gin) or Node.js (NestJS / Hono) for high-performance async I/O.
* **Admin Console Frontend**: Next.js (App Router) + TypeScript
* **UI Framework & Styling**: Tailwind CSS + Shadcn UI + Lucide Icons
* **Data Visualization**: Recharts or Tremor UI for analytical graphs
* **Database**: PostgreSQL (for users, keys, and logs) + Prisma ORM / GORM
* **Cache & Rate Limiter**: Redis (for token bucket rate limiting and session states)
* **Containerization**: Docker & Docker Compose setup

---

## Part 3: Testing & Acceptance Protocols for AI Agent

When the AI Agent executes automated tests on headless Linux environments via ADB, it must verify the following:

1. **Build Verification**: Clean compilation using `./gradlew assembleDebug` with JVM heap allocation limited to 2GB (`-Xmx2048m`).
2. **SSE Streaming Stability Test**: Mock a streaming API response with delayed chunks to verify UI non-blocking behavior and auto-scrolling list synchronization.
3. **UI State Transition Test**: Assert that switching models in the top bar instantly updates `MaterialTheme` colors and replaces the primary icon sets.
4. **Reasoning Parsing Test**: Feed a mock payload containing `<think>Step 1... Step 2...</think>` and verify that the output is separated into an expandable reasoning card and a primary answer block.
