# GLOSSARY

Repository vocabulary for the NekoCode IPC architecture.

- **IpcRouter** — The type-safe handler registration API for renderer→main IPC channels. It applies uniform sender validation and owns the single error boundary shared by all registered handlers.
- **IpcChannelMap** — The single source of truth for the request payload and result types of every renderer→main IPC channel.
- **RendererChannelMap** — The single source of truth for the payload types of every main→renderer push event.
- **IPC handler** — A main-process function registered for an IPC channel that bridges a renderer request to a manager (session, project, or git) and returns the channel's result.
