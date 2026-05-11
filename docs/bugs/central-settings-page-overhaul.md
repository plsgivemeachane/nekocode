Central Settings Page Overhaul
==============================
Date: 2026-05-10

## Problem
The system configuration was fragmented: notification settings were accessed via a small bell icon in the TreeSidebar header, which opened a popup panel. There was no central place to configure all aspects of the application (notifications, appearance, etc.). This led to:
- Discovery issues: users could not easily find notification settings
- Scalability issues: no natural place to add new settings categories
- UX inconsistency: settings accessed through icon buttons rather than a dedicated page

## Solution
Created a central Settings page accessible via a gear icon in the TreeSidebar header, replacing the notification bell icon. The Settings page consolidates all configuration into clearly organized sections:

1. **Notifications** - All notification/sound settings (migrated from NotificationSettingsPanel)
2. **Appearance** - Zoom controls (migrated from NavBar)
3. **About** - Application info

## Changes Made

### New Files
- `src/renderer/src/components/settings/SettingsView.tsx` - Central settings page component with header (back button + title), scrollable content area, and organized sections
- `src/renderer/src/components/ui/NotificationSettingsContent.tsx` - Extracted inline notification settings content (shared between popup and settings page)

### Modified Files
- `src/renderer/src/stores/project-store.tsx`
  - Added `ActiveView` type (`'chat' | 'settings'`)
  - Added `activeView` field to `ProjectState` interface (default: `'chat'`)
  - Added `SET_ACTIVE_VIEW` action to reducer
  - Added `setActiveView` method to `ProjectStoreAPI`
  - `SET_ACTIVE_SESSION` now also sets `activeView` to `'chat'` so clicking a session returns to the chat view

- `src/renderer/src/components/layout/TreeSidebar.tsx`
  - Removed bell/notification icon button and its `showNotificationSettings` state
  - Replaced with gear/settings icon that calls `setActiveView('settings')`
  - Removed `NotificationSettingsPanel` import (now only used in SettingsView)

- `src/renderer/src/App.tsx`
  - Added `SettingsView` import
  - Conditional rendering: shows `SettingsView` when `activeView === 'settings'`, otherwise `ChatView`

- `src/renderer/src/components/ui/NotificationSettingsPanel.tsx`
  - Refactored to use extracted `NotificationSettingsContent` component
  - Now a thin wrapper that provides the popup dialog chrome around `NotificationSettingsContent`
  - Removed all inline settings logic (moved to `NotificationSettingsContent`)

## Architecture Decisions
- **ActiveView in project-store**: The view state is global because the TreeSidebar and App layout both need to read/write it
- **NotificationSettingsContent extraction**: Rather than duplicating notification settings code, the content was extracted into a shared component used by both the popup panel (backward compat) and the Settings page
- **Session click returns to chat**: When a user clicks a session in the sidebar while viewing settings, it naturally switches back to the chat view
