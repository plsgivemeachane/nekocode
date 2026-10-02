# Empty file-search queries leave debounce timers running after unmount

## Symptoms and cause

The full opencodeui test suite intermittently reported an unhandled rejection:
`ReferenceError: window is not defined`, originating from useSearchFiles after
ChatView's jsdom environment had been torn down. The hook schedules an initial
file search for empty or whitespace-only queries, then returns from its effect
without registering cleanup. The timer therefore survives component unmount
and attempts a React state update after the test environment disappears.

## Fix and verification

The empty-query effect now returns cleanup that cancels its debounce timer and
marks the request aborted, matching the existing nonempty-query cleanup. No
search result or debounce behavior changes while the component remains mounted.

Fake-timer regression tests unmount before the debounce delay and confirm no IPC
request runs for empty, whitespace-only, or nonempty queries. Empty and
whitespace cases failed before the fix. The full test suite is checked without
suppressing unhandled errors.
