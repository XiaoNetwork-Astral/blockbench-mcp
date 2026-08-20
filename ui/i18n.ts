/**
 * Internationalization (i18n) support for the MCP plugin.
 *
 * Uses Blockbench's built-in translation system:
 * - Language.addTranslations(langCode, { key: value }) to register translations
 * - tl('key') or tl('key', variables) to get translated strings
 *
 * Translation keys follow the pattern: mcp.<section>.<item>
 */

// English translations (fallback)
const en: Record<string, string> = {
  // Panel sections
  "mcp.panel.sessions": "Sessions",
  "mcp.panel.server": "Server",
  "mcp.panel.tools": "Tools",
  "mcp.panel.resources": "Resources",
  "mcp.panel.prompts": "Prompts",

  // Audit panel
  "mcp.audit.panel_name": "Codex Operations",
  "mcp.audit.show_panel": "Codex Blockbench MCP: Show Operations",
  "mcp.audit.show_panel_description": "Show the per-model MCP operation history and native Undo controls",
  "mcp.audit.search_placeholder": "Search Codex operations...",
  "mcp.audit.refresh": "Refresh",
  "mcp.audit.settings": "Plugin settings",
  "mcp.audit.hide": "Hide panel",
  "mcp.audit.model": "Model",
  "mcp.audit.current_model": "Current model",
  "mcp.audit.all_models": "All models",
  "mcp.audit.all_models_search": "All models (search only)",
  "mcp.audit.all_models_readonly": "All models is a read-only search view. Choose one model before restoring its history.",
  "mcp.audit.no_model": "No model",
  "mcp.audit.untitled": "Untitled",
  "mcp.audit.source": "Source",
  "mcp.audit.source_mcp": "Codex / MCP",
  "mcp.audit.source_user": "Manual",
  "mcp.audit.source_panel": "History panel",
  "mcp.audit.source_system": "System",
  "mcp.audit.source_unknown": "Unknown",
  "mcp.audit.all_sources": "All sources",
  "mcp.audit.status": "Status",
  "mcp.audit.status_running": "Running",
  "mcp.audit.status_success": "Succeeded",
  "mcp.audit.status_error": "Failed",
  "mcp.audit.all_statuses": "All statuses",
  "mcp.audit.tool": "Tool",
  "mcp.audit.all_tools": "All tools",
  "mcp.audit.manual_edit": "Manual Blockbench edit",
  "mcp.audit.manual_undo": "Manual Undo",
  "mcp.audit.manual_redo": "Manual Redo",
  "mcp.audit.persistent_storage": "Operation summaries and lazy details are stored in Blockbench's local database.",
  "mcp.audit.session_storage": "Persistent browser storage is unavailable; records last for this Blockbench session only.",
  "mcp.audit.saved_locally": "Saved locally",
  "mcp.audit.session_only": "Session only",
  "mcp.audit.loading": "Loading operations...",
  "mcp.audit.loading_details": "Loading details...",
  "mcp.audit.no_operations": "No matching operations for this model.",
  "mcp.audit.running": "running",
  "mcp.audit.undo_entries": "%0 Undo entries",
  "mcp.audit.started": "Started",
  "mcp.audit.undo_position": "Undo position",
  "mcp.audit.client": "Client",
  "mcp.audit.arguments": "Sanitized arguments",
  "mcp.audit.result": "Sanitized result",
  "mcp.audit.error": "Error",
  "mcp.audit.native_undo_entries": "Native Undo entries (%0)",
  "mcp.audit.details_unavailable": "Details are no longer available.",
  "mcp.audit.restore_before": "Operation before",
  "mcp.audit.restore_after": "Operation after",
  "mcp.audit.restore_before_help": "Move only this model's native Undo stack to the state before the operation",
  "mcp.audit.restore_after_help": "Move only this model's native Undo stack to the state after the operation",
  "mcp.audit.choose_model_first": "Choose one model first; the all-model view cannot change history",
  "mcp.audit.not_reversible": "No live native Undo state",
  "mcp.audit.already_at_state": "This model is already at that state",
  "mcp.audit.restored_steps": "%0: moved %1 native Undo steps",
  "mcp.audit.confirm_title": "Cross manual edits?",
  "mcp.audit.confirm_cross_manual": "Moving model “%1” to this state crosses %0 manual or unknown edits:",
  "mcp.audit.confirm_cross_manual_tail": "Only this model will be affected. Continue only if you intend to undo or redo those manual edits too.",
  "mcp.audit.more_edits": "…and %0 more edits",
  "mcp.audit.continue": "Continue",
  "mcp.audit.ok": "OK",
  "mcp.audit.restore_failed": "Unable to restore model history",
  "mcp.audit.clear_title": "Clear operation records",
  "mcp.audit.clear_message": "Delete the searchable audit records? This does not alter any model or its native Undo stack.",
  "mcp.audit.clear": "Clear records",
  "mcp.audit.previous_page": "Previous page",
  "mcp.audit.next_page": "Next page",
  "mcp.audit.page": "Page %0",
  "mcp.audit.per_page": "Per page",

  // Sessions section
  "mcp.sessions.no_clients": "No clients connected",

  // Server section
  "mcp.server.name": "Server Name",
  "mcp.server.version": "Server Version",
  "mcp.server.connected_clients": "Connected Clients",

  // Filter UI
  "mcp.filter.tools_placeholder": "Filter tools...",
  "mcp.filter.resources_placeholder": "Filter resources...",
  "mcp.filter.prompts_placeholder": "Filter prompts...",
  "mcp.filter.show_experimental": "Show Experimental",

  // Empty states
  "mcp.tools.no_match": "No tools match your filter.",
  "mcp.tools.none_available": "No tools available.",
  "mcp.resources.no_match": "No resources match your filter.",
  "mcp.resources.none_available": "No resources available.",
  "mcp.prompts.no_match": "No prompts match your filter.",
  "mcp.prompts.none_available": "No prompts available.",

  // Prompts
  "mcp.prompts.argument_count": "%0 argument",
  "mcp.prompts.argument_count_plural": "%0 arguments",

  // Tooltips
  "mcp.tooltip.click_to_test": "Click to test %0",
  "mcp.tooltip.click_to_preview": "Click to preview %0",
  "mcp.tooltip.click_to_view_panel": "Click to view MCP panel",

  // Status bar
  "mcp.status.experimental_tooltip": "This tool is experimental",
  "mcp.status.server": "MCP Server",
  "mcp.status.server_one_client": "MCP Server (1 client)",
  "mcp.status.server_clients": "MCP Server (%0 clients)",

  // Settings
  "mcp.settings.category_name": "Codex Blockbench MCP",
  "mcp.settings.open_action": "Codex Blockbench MCP: Settings",
  "mcp.settings.open_action_desc": "Open the native Blockbench settings for the MCP server and operation history",
  "mcp.settings.bind_host_name": "Listen Address",
  "mcp.settings.bind_host_desc": "Address only, without a scheme or port. Non-loopback addresses can expose the server to other devices.",
  "mcp.settings.bind_host_warning_title": "MCP server may be reachable from the network",
  "mcp.settings.bind_host_warning_message": "The listen address %0 is not local-only. Other devices or proxy software may be able to reach this server. Bearer authentication remains required; keep the token private.",
  "mcp.settings.bind_host_active_warning": "Codex MCP is listening on non-loopback address %0",
  "mcp.settings.port_name": "Server Port",
  "mcp.settings.port_desc": "TCP port used by the MCP server.",
  "mcp.settings.endpoint_name": "Server Endpoint",
  "mcp.settings.endpoint_desc": "HTTP path used by MCP clients.",
  "mcp.settings.auth_token_name": "MCP Bearer Token",
  "mcp.settings.auth_token_desc": "Required on every request. Keep it private; use the refresh icon to replace it.",
  "mcp.settings.regenerate_token_name": "Regenerate MCP Token",
  "mcp.settings.regenerate_token_desc": "Replace the current token. Reload the plugin and update Codex afterward.",
  "mcp.settings.token_regenerated": "New MCP token saved; restart the plugin and update Codex",
  "mcp.settings.prompt_cdn_name": "Enable Prompt CDN",
  "mcp.settings.prompt_cdn_desc": "Fetch prompt content from CDN on plugin load. Disable to use only cached prompts.",
  "mcp.settings.session_timeout_name": "Session Inactivity Timeout (minutes)",
  "mcp.settings.session_timeout_desc": "Disconnect MCP sessions after this many minutes of inactivity. Lower values free resources faster; higher values tolerate idle clients.",
  "mcp.settings.sse_heartbeat_name": "SSE Heartbeat Interval (seconds)",
  "mcp.settings.sse_heartbeat_desc": "Send keep-alive comments on streaming responses to prevent proxies/firewalls from closing idle connections. Set to 0 to disable.",
  "mcp.settings.audit_retention_name": "Operation History Retention",
  "mcp.settings.audit_retention_desc": "Maximum number of searchable operation records kept locally. Oldest records are removed first. Allowed maximum: %0.",
  "mcp.settings.audit_page_size_name": "Default Operations Per Page",
  "mcp.settings.audit_page_size_desc": "Default page size for the Codex operations panel. It can also be changed temporarily in the panel.",
  "mcp.settings.audit_page_size_option": "%0 operations",
  "mcp.settings.audit_scope_name": "Default History Model Scope",
  "mcp.settings.audit_scope_desc": "Open the operations panel on the current model, or in the read-only all-model search view.",
  "mcp.settings.audit_scope_current": "Current model",
  "mcp.settings.audit_scope_all": "All models (search only)",
  "mcp.settings.audit_source_name": "Default History Source",
  "mcp.settings.audit_source_desc": "Show only Codex/MCP calls by default, or include manual and panel history rows.",
  "mcp.settings.audit_source_mcp": "Codex / MCP only",
  "mcp.settings.audit_source_all": "All sources",
  "mcp.settings.audit_manual_name": "Store Manual Edit Rows",
  "mcp.settings.audit_manual_desc": "Show manual edit/Undo/Redo rows in searchable history. Manual boundaries are still detected for rollback safety when this is off.",

  // Tool test dialog
  "mcp.dialog.result_title": "Result: %0",
  "mcp.dialog.no_parameters": "This tool has no parameters.",
  "mcp.dialog.run_tool": "Run Tool",
  "mcp.dialog.copy_input": "Copy Input",
  "mcp.dialog.cancel": "Cancel",
  "mcp.dialog.close": "Close",
  "mcp.dialog.json_array_placeholder": "Enter JSON array, e.g. [1, 2, 3]",
  "mcp.dialog.json_object_placeholder": "Enter JSON object",
  "mcp.dialog.input_copied": "Input copied to clipboard",
  "mcp.dialog.copy_failed": "Failed to copy to clipboard",
  "mcp.dialog.running_tool": "Running tool...",
  "mcp.dialog.tool_not_found": "Tool \"%0\" not found",

  // Prompt preview dialog
  "mcp.dialog.prompt_title": "Prompt: %0",
  "mcp.dialog.copy": "Copy",
  "mcp.dialog.prompt_copied": "Prompt copied to clipboard",
  "mcp.dialog.no_arguments": "This prompt has no arguments.",
  "mcp.dialog.generate_prompt": "Generate Prompt",
  "mcp.dialog.generating_prompt": "Generating prompt...",
  "mcp.dialog.prompt_not_found": "Prompt \"%0\" not found",
  "mcp.dialog.role_user": "User",
  "mcp.dialog.role_assistant": "Assistant",

  // Prompt override dialog
  "mcp.dialog.edit_override": "Edit Override",
  "mcp.dialog.save_override": "Save Override",
  "mcp.dialog.reset_to_default": "Reset to Default",
  "mcp.dialog.override_saved": "Custom prompt override saved",
  "mcp.dialog.override_reset": "Prompt reset to default",
  "mcp.dialog.using_custom": "Using: Custom Override",
  "mcp.dialog.using_default": "Using: Default (v%0)",
  "mcp.prompts.custom_badge": "custom",
};

// German translations
const de: Record<string, string> = {
  // Panel sections
  "mcp.panel.sessions": "Sitzungen",
  "mcp.panel.server": "Server",
  "mcp.panel.tools": "Werkzeuge",
  "mcp.panel.resources": "Ressourcen",
  "mcp.panel.prompts": "Prompts",

  // Sessions section
  "mcp.sessions.no_clients": "Keine Clients verbunden",

  // Server section
  "mcp.server.name": "Servername",
  "mcp.server.version": "Serverversion",
  "mcp.server.connected_clients": "Verbundene Clients",

  // Filter UI
  "mcp.filter.tools_placeholder": "Werkzeuge filtern...",
  "mcp.filter.resources_placeholder": "Ressourcen filtern...",
  "mcp.filter.prompts_placeholder": "Prompts filtern...",
  "mcp.filter.show_experimental": "Experimentelle anzeigen",

  // Empty states
  "mcp.tools.no_match": "Keine Werkzeuge entsprechen Ihrem Filter.",
  "mcp.tools.none_available": "Keine Werkzeuge verfügbar.",
  "mcp.resources.no_match": "Keine Ressourcen entsprechen Ihrem Filter.",
  "mcp.resources.none_available": "Keine Ressourcen verfügbar.",
  "mcp.prompts.no_match": "Keine Prompts entsprechen Ihrem Filter.",
  "mcp.prompts.none_available": "Keine Prompts verfügbar.",

  // Prompts
  "mcp.prompts.argument_count": "%0 Argument",
  "mcp.prompts.argument_count_plural": "%0 Argumente",

  // Tooltips
  "mcp.tooltip.click_to_test": "Klicken zum Testen von %0",
  "mcp.tooltip.click_to_preview": "Klicken zur Vorschau von %0",
  "mcp.tooltip.click_to_view_panel": "Klicken zum Anzeigen des MCP-Panels",

  // Status bar
  "mcp.status.experimental_tooltip": "Dieses Werkzeug ist experimentell",
  "mcp.status.server": "MCP Server",
  "mcp.status.server_one_client": "MCP Server (1 Client)",
  "mcp.status.server_clients": "MCP Server (%0 Clients)",

  // Settings
  "mcp.settings.category_name": "Codex Blockbench MCP",
  "mcp.settings.open_action": "Codex Blockbench MCP: Einstellungen",
  "mcp.settings.open_action_desc": "Die Blockbench-Einstellungen für MCP und den Operationsverlauf öffnen",
  "mcp.settings.bind_host_name": "Listen-Adresse",
  "mcp.settings.bind_host_desc": "Nur Adresse, ohne Protokoll oder Port. Nicht-lokale Adressen können den Server für andere Geräte erreichbar machen.",
  "mcp.settings.bind_host_warning_title": "Der MCP-Server kann aus dem Netzwerk erreichbar sein",
  "mcp.settings.bind_host_warning_message": "Die Listen-Adresse %0 ist nicht rein lokal. Andere Geräte oder Proxy-Software können den Server möglicherweise erreichen. Die Bearer-Authentifizierung bleibt erforderlich.",
  "mcp.settings.bind_host_active_warning": "Codex MCP lauscht auf der nicht-lokalen Adresse %0",
  "mcp.settings.port_name": "MCP Server Port",
  "mcp.settings.port_desc": "Port für den MCP-Server.",
  "mcp.settings.endpoint_name": "MCP Server Endpunkt",
  "mcp.settings.endpoint_desc": "Endpunkt für den MCP-Server.",
  "mcp.settings.prompt_cdn_name": "Prompt-CDN aktivieren",
  "mcp.settings.prompt_cdn_desc": "Prompt-Inhalte beim Laden des Plugins vom CDN abrufen. Deaktivieren, um nur zwischengespeicherte Prompts zu verwenden.",
  "mcp.settings.session_timeout_name": "Sitzungs-Inaktivitäts-Timeout (Minuten)",
  "mcp.settings.session_timeout_desc": "MCP-Sitzungen nach dieser Anzahl von Minuten Inaktivität trennen. Niedrigere Werte geben Ressourcen schneller frei; höhere Werte tolerieren inaktive Clients.",
  "mcp.settings.sse_heartbeat_name": "SSE-Heartbeat-Intervall (Sekunden)",
  "mcp.settings.sse_heartbeat_desc": "Sendet Keep-Alive-Kommentare auf Streaming-Antworten, um zu verhindern, dass Proxys/Firewalls inaktive Verbindungen schließen. Auf 0 setzen zum Deaktivieren.",

  // Tool test dialog
  "mcp.dialog.result_title": "Ergebnis: %0",
  "mcp.dialog.no_parameters": "Dieses Werkzeug hat keine Parameter.",
  "mcp.dialog.run_tool": "Werkzeug ausführen",
  "mcp.dialog.copy_input": "Eingabe kopieren",
  "mcp.dialog.cancel": "Abbrechen",
  "mcp.dialog.close": "Schließen",
  "mcp.dialog.json_array_placeholder": "JSON-Array eingeben, z.B. [1, 2, 3]",
  "mcp.dialog.json_object_placeholder": "JSON-Objekt eingeben",
  "mcp.dialog.input_copied": "Eingabe in Zwischenablage kopiert",
  "mcp.dialog.copy_failed": "Kopieren in Zwischenablage fehlgeschlagen",
  "mcp.dialog.running_tool": "Werkzeug wird ausgeführt...",
  "mcp.dialog.tool_not_found": "Werkzeug \"%0\" nicht gefunden",

  // Prompt preview dialog
  "mcp.dialog.prompt_title": "Prompt: %0",
  "mcp.dialog.copy": "Kopieren",
  "mcp.dialog.prompt_copied": "Prompt in Zwischenablage kopiert",
  "mcp.dialog.no_arguments": "Dieser Prompt hat keine Argumente.",
  "mcp.dialog.generate_prompt": "Prompt generieren",
  "mcp.dialog.generating_prompt": "Prompt wird generiert...",
  "mcp.dialog.prompt_not_found": "Prompt \"%0\" nicht gefunden",
  "mcp.dialog.role_user": "Benutzer",
  "mcp.dialog.role_assistant": "Assistent",

  // Prompt override dialog
  "mcp.dialog.edit_override": "Override bearbeiten",
  "mcp.dialog.save_override": "Override speichern",
  "mcp.dialog.reset_to_default": "Auf Standard zurücksetzen",
  "mcp.dialog.override_saved": "Benutzerdefiniertes Prompt-Override gespeichert",
  "mcp.dialog.override_reset": "Prompt auf Standard zurückgesetzt",
  "mcp.dialog.using_custom": "Verwendet: Benutzerdefiniert",
  "mcp.dialog.using_default": "Verwendet: Standard (v%0)",
  "mcp.prompts.custom_badge": "custom",
};

// Japanese translations
const ja: Record<string, string> = {
  // Panel sections
  "mcp.panel.sessions": "セッション",
  "mcp.panel.server": "サーバー",
  "mcp.panel.tools": "ツール",
  "mcp.panel.resources": "リソース",
  "mcp.panel.prompts": "プロンプト",

  // Sessions section
  "mcp.sessions.no_clients": "クライアントが接続されていません",

  // Server section
  "mcp.server.name": "サーバー名",
  "mcp.server.version": "サーバーバージョン",
  "mcp.server.connected_clients": "接続中のクライアント",

  // Filter UI
  "mcp.filter.tools_placeholder": "ツールを検索...",
  "mcp.filter.resources_placeholder": "リソースを検索...",
  "mcp.filter.prompts_placeholder": "プロンプトを検索...",
  "mcp.filter.show_experimental": "実験的を表示",

  // Empty states
  "mcp.tools.no_match": "フィルターに一致するツールがありません。",
  "mcp.tools.none_available": "利用可能なツールがありません。",
  "mcp.resources.no_match": "フィルターに一致するリソースがありません。",
  "mcp.resources.none_available": "利用可能なリソースがありません。",
  "mcp.prompts.no_match": "フィルターに一致するプロンプトがありません。",
  "mcp.prompts.none_available": "利用可能なプロンプトがありません。",

  // Prompts
  "mcp.prompts.argument_count": "%0 引数",
  "mcp.prompts.argument_count_plural": "%0 引数",

  // Tooltips
  "mcp.tooltip.click_to_test": "クリックして %0 をテスト",
  "mcp.tooltip.click_to_preview": "クリックして %0 をプレビュー",
  "mcp.tooltip.click_to_view_panel": "クリックしてMCPパネルを表示",

  // Status bar
  "mcp.status.experimental_tooltip": "このツールは実験的です",
  "mcp.status.server": "MCPサーバー",
  "mcp.status.server_one_client": "MCPサーバー (1クライアント)",
  "mcp.status.server_clients": "MCPサーバー (%0クライアント)",

  // Settings
  "mcp.settings.bind_host_name": "待ち受けアドレス",
  "mcp.settings.bind_host_desc": "スキームやポートを含まないアドレスです。ループバック以外では他の端末から到達できる可能性があります。",
  "mcp.settings.bind_host_warning_title": "MCPサーバーがネットワークから到達可能です",
  "mcp.settings.bind_host_warning_message": "待ち受けアドレス %0 はローカル専用ではありません。他の端末やプロキシから到達できる可能性があります。Bearer認証は引き続き必須です。",
  "mcp.settings.bind_host_active_warning": "Codex MCP は非ループバックアドレス %0 で待ち受けています",
  "mcp.settings.port_name": "MCPサーバーポート",
  "mcp.settings.port_desc": "MCPサーバーのポート。",
  "mcp.settings.endpoint_name": "MCPサーバーエンドポイント",
  "mcp.settings.endpoint_desc": "MCPサーバーのエンドポイント。",
  "mcp.settings.prompt_cdn_name": "プロンプトCDNを有効化",
  "mcp.settings.prompt_cdn_desc": "プラグイン読み込み時にCDNからプロンプト内容を取得します。無効にするとキャッシュされたプロンプトのみ使用します。",
  "mcp.settings.session_timeout_name": "セッション非アクティブタイムアウト (分)",
  "mcp.settings.session_timeout_desc": "この分数の非アクティブ後にMCPセッションを切断します。値が小さいほどリソースを早く解放し、大きいほどアイドルクライアントを許容します。",
  "mcp.settings.sse_heartbeat_name": "SSEハートビート間隔 (秒)",
  "mcp.settings.sse_heartbeat_desc": "ストリーミング応答にキープアライブコメントを送信し、プロキシ/ファイアウォールがアイドル接続を閉じるのを防ぎます。0に設定すると無効になります。",

  // Tool test dialog
  "mcp.dialog.result_title": "結果: %0",
  "mcp.dialog.no_parameters": "このツールにはパラメータがありません。",
  "mcp.dialog.run_tool": "ツールを実行",
  "mcp.dialog.copy_input": "入力をコピー",
  "mcp.dialog.cancel": "キャンセル",
  "mcp.dialog.close": "閉じる",
  "mcp.dialog.json_array_placeholder": "JSON配列を入力 (例: [1, 2, 3])",
  "mcp.dialog.json_object_placeholder": "JSONオブジェクトを入力",
  "mcp.dialog.input_copied": "入力をクリップボードにコピーしました",
  "mcp.dialog.copy_failed": "クリップボードへのコピーに失敗しました",
  "mcp.dialog.running_tool": "ツールを実行中...",
  "mcp.dialog.tool_not_found": "ツール \"%0\" が見つかりません",

  // Prompt preview dialog
  "mcp.dialog.prompt_title": "プロンプト: %0",
  "mcp.dialog.copy": "コピー",
  "mcp.dialog.prompt_copied": "プロンプトをクリップボードにコピーしました",
  "mcp.dialog.no_arguments": "このプロンプトには引数がありません。",
  "mcp.dialog.generate_prompt": "プロンプトを生成",
  "mcp.dialog.generating_prompt": "プロンプトを生成中...",
  "mcp.dialog.prompt_not_found": "プロンプト \"%0\" が見つかりません",
  "mcp.dialog.role_user": "ユーザー",
  "mcp.dialog.role_assistant": "アシスタント",

  // Prompt override dialog
  "mcp.dialog.edit_override": "オーバーライドを編集",
  "mcp.dialog.save_override": "オーバーライドを保存",
  "mcp.dialog.reset_to_default": "デフォルトに戻す",
  "mcp.dialog.override_saved": "カスタムプロンプトオーバーライドを保存しました",
  "mcp.dialog.override_reset": "プロンプトをデフォルトに戻しました",
  "mcp.dialog.using_custom": "使用中: カスタム",
  "mcp.dialog.using_default": "使用中: デフォルト (v%0)",
  "mcp.prompts.custom_badge": "カスタム",
};

// Chinese (Simplified) translations
const zh: Record<string, string> = {
  // Panel sections
  "mcp.panel.sessions": "会话",
  "mcp.panel.server": "服务器",
  "mcp.panel.tools": "工具",
  "mcp.panel.resources": "资源",
  "mcp.panel.prompts": "提示词",

  // 操作审计面板
  "mcp.audit.panel_name": "Codex 操作记录",
  "mcp.audit.show_panel": "Codex Blockbench MCP：显示操作记录",
  "mcp.audit.show_panel_description": "显示各模型独立的 MCP 操作历史与原生撤销控制",
  "mcp.audit.search_placeholder": "搜索 Codex 操作……",
  "mcp.audit.refresh": "刷新",
  "mcp.audit.settings": "插件设置",
  "mcp.audit.hide": "隐藏面板",
  "mcp.audit.model": "模型",
  "mcp.audit.current_model": "当前模型",
  "mcp.audit.all_models": "全部模型",
  "mcp.audit.all_models_search": "全部模型（只读搜索）",
  "mcp.audit.all_models_readonly": "“全部模型”只用于搜索。请先选择一个模型，再恢复它自己的历史。",
  "mcp.audit.no_model": "无模型",
  "mcp.audit.untitled": "未命名",
  "mcp.audit.source": "来源",
  "mcp.audit.source_mcp": "Codex / MCP",
  "mcp.audit.source_user": "手工操作",
  "mcp.audit.source_panel": "历史面板",
  "mcp.audit.source_system": "系统",
  "mcp.audit.source_unknown": "来源未知",
  "mcp.audit.all_sources": "全部来源",
  "mcp.audit.status": "状态",
  "mcp.audit.status_running": "进行中",
  "mcp.audit.status_success": "成功",
  "mcp.audit.status_error": "失败",
  "mcp.audit.all_statuses": "全部状态",
  "mcp.audit.tool": "工具",
  "mcp.audit.all_tools": "全部工具",
  "mcp.audit.manual_edit": "Blockbench 手工编辑",
  "mcp.audit.manual_undo": "手工撤销",
  "mcp.audit.manual_redo": "手工重做",
  "mcp.audit.persistent_storage": "操作概要和按需加载的详情保存在 Blockbench 本地数据库中。",
  "mcp.audit.session_storage": "持久存储不可用；记录只保留到本次 Blockbench 会话结束。",
  "mcp.audit.saved_locally": "已在本地保存",
  "mcp.audit.session_only": "仅本次会话",
  "mcp.audit.loading": "正在读取操作……",
  "mcp.audit.loading_details": "正在读取详情……",
  "mcp.audit.no_operations": "这个模型没有符合条件的操作。",
  "mcp.audit.running": "进行中",
  "mcp.audit.undo_entries": "%0 个撤销条目",
  "mcp.audit.started": "开始时间",
  "mcp.audit.undo_position": "撤销位置",
  "mcp.audit.client": "客户端",
  "mcp.audit.arguments": "已脱敏参数",
  "mcp.audit.result": "已脱敏结果",
  "mcp.audit.error": "错误",
  "mcp.audit.native_undo_entries": "原生撤销条目（%0）",
  "mcp.audit.details_unavailable": "这条记录的详情已经不可用。",
  "mcp.audit.restore_before": "回到操作前",
  "mcp.audit.restore_after": "回到操作后",
  "mcp.audit.restore_before_help": "只移动这一模型的原生撤销栈，恢复到该操作以前",
  "mcp.audit.restore_after_help": "只移动这一模型的原生撤销栈，恢复到该操作以后",
  "mcp.audit.choose_model_first": "请先选择一个模型；全部模型视图不能改动历史",
  "mcp.audit.not_reversible": "没有仍有效的原生撤销状态",
  "mcp.audit.already_at_state": "这个模型已经处于该状态",
  "mcp.audit.restored_steps": "%0：移动了 %1 个原生撤销步骤",
  "mcp.audit.confirm_title": "要跨过手工编辑吗？",
  "mcp.audit.confirm_cross_manual": "把模型“%1”恢复到这里，会跨过 %0 个手工或来源未知的编辑：",
  "mcp.audit.confirm_cross_manual_tail": "只有这个模型会受影响。请仅在确实要一并撤销或重做这些手工编辑时继续。",
  "mcp.audit.more_edits": "……以及另外 %0 个编辑",
  "mcp.audit.continue": "继续",
  "mcp.audit.ok": "确定",
  "mcp.audit.restore_failed": "无法恢复模型历史",
  "mcp.audit.clear_title": "清空操作记录",
  "mcp.audit.clear_message": "删除可搜索的审计记录吗？这不会改动任何模型或它们的原生撤销栈。",
  "mcp.audit.clear": "清空记录",
  "mcp.audit.previous_page": "上一页",
  "mcp.audit.next_page": "下一页",
  "mcp.audit.page": "第 %0 页",
  "mcp.audit.per_page": "每页",

  // Sessions section
  "mcp.sessions.no_clients": "没有客户端连接",

  // Server section
  "mcp.server.name": "服务器名称",
  "mcp.server.version": "服务器版本",
  "mcp.server.connected_clients": "已连接客户端",

  // Filter UI
  "mcp.filter.tools_placeholder": "筛选工具...",
  "mcp.filter.resources_placeholder": "筛选资源...",
  "mcp.filter.prompts_placeholder": "筛选提示词...",
  "mcp.filter.show_experimental": "显示实验性",

  // Empty states
  "mcp.tools.no_match": "没有匹配的工具。",
  "mcp.tools.none_available": "没有可用的工具。",
  "mcp.resources.no_match": "没有匹配的资源。",
  "mcp.resources.none_available": "没有可用的资源。",
  "mcp.prompts.no_match": "没有匹配的提示词。",
  "mcp.prompts.none_available": "没有可用的提示词。",

  // Prompts
  "mcp.prompts.argument_count": "%0 个参数",
  "mcp.prompts.argument_count_plural": "%0 个参数",

  // Tooltips
  "mcp.tooltip.click_to_test": "点击测试 %0",
  "mcp.tooltip.click_to_preview": "点击预览 %0",
  "mcp.tooltip.click_to_view_panel": "点击查看MCP面板",

  // Status bar
  "mcp.status.experimental_tooltip": "此工具为实验性功能",
  "mcp.status.server": "MCP服务器",
  "mcp.status.server_one_client": "MCP服务器 (1个客户端)",
  "mcp.status.server_clients": "MCP服务器 (%0个客户端)",

  // Settings
  "mcp.settings.category_name": "Codex Blockbench MCP",
  "mcp.settings.open_action": "Codex Blockbench MCP：设置",
  "mcp.settings.open_action_desc": "在 Blockbench 原生设置界面中配置 MCP 服务与操作记录",
  "mcp.settings.bind_host_name": "监听地址",
  "mcp.settings.bind_host_desc": "只填写地址，不含协议和端口。非回环地址可能让其他设备访问此服务。",
  "mcp.settings.bind_host_warning_title": "MCP 服务可能暴露到网络",
  "mcp.settings.bind_host_warning_message": "监听地址 %0 并非仅限本机；其他设备或代理软件可能访问此服务。Bearer 认证仍然强制启用，请妥善保管令牌。",
  "mcp.settings.bind_host_active_warning": "Codex MCP 正在非回环地址 %0 上监听",
  "mcp.settings.port_name": "服务端口",
  "mcp.settings.port_desc": "MCP 服务使用的 TCP 端口。",
  "mcp.settings.endpoint_name": "服务端点",
  "mcp.settings.endpoint_desc": "MCP 客户端使用的 HTTP 路径。",
  "mcp.settings.auth_token_name": "MCP Bearer 令牌",
  "mcp.settings.auth_token_desc": "每个请求都必须携带。请勿外传；可用右侧刷新图标替换令牌。",
  "mcp.settings.regenerate_token_name": "重新生成 MCP 令牌",
  "mcp.settings.regenerate_token_desc": "替换当前令牌；完成后请重新加载插件并更新 Codex 配置。",
  "mcp.settings.token_regenerated": "新 MCP 令牌已保存；请重启插件并更新 Codex 配置",
  "mcp.settings.prompt_cdn_name": "启用提示词CDN",
  "mcp.settings.prompt_cdn_desc": "插件加载时从CDN获取提示词内容。禁用后仅使用缓存的提示词。",
  "mcp.settings.session_timeout_name": "会话非活动超时（分钟）",
  "mcp.settings.session_timeout_desc": "在非活动指定分钟数后断开 MCP 会话。较低的值更快释放资源；较高的值容忍空闲客户端。",
  "mcp.settings.sse_heartbeat_name": "SSE 心跳间隔（秒）",
  "mcp.settings.sse_heartbeat_desc": "在流式响应上发送保活注释，防止代理/防火墙关闭空闲连接。设为 0 表示禁用。",
  "mcp.settings.audit_retention_name": "操作记录保留数量",
  "mcp.settings.audit_retention_desc": "本地最多保留多少条可搜索操作记录，超出后先删除最旧记录。允许的最大值为 %0。",
  "mcp.settings.audit_page_size_name": "操作面板默认每页数量",
  "mcp.settings.audit_page_size_desc": "Codex 操作面板的默认分页大小；仍可在面板里临时调整。",
  "mcp.settings.audit_page_size_option": "每页 %0 条",
  "mcp.settings.audit_scope_name": "操作记录默认模型范围",
  "mcp.settings.audit_scope_desc": "打开面板时显示当前模型，或进入只能搜索的全部模型视图。",
  "mcp.settings.audit_scope_current": "当前模型",
  "mcp.settings.audit_scope_all": "全部模型（只读搜索）",
  "mcp.settings.audit_source_name": "操作记录默认来源",
  "mcp.settings.audit_source_desc": "默认只显示 Codex/MCP 调用，或同时显示手工操作与历史面板操作。",
  "mcp.settings.audit_source_mcp": "仅 Codex / MCP",
  "mcp.settings.audit_source_all": "全部来源",
  "mcp.settings.audit_manual_name": "保存手工编辑记录行",
  "mcp.settings.audit_manual_desc": "在可搜索记录中显示手工编辑、撤销和重做。即使关闭，仍会识别手工边界以保证回滚安全。",

  // Tool test dialog
  "mcp.dialog.result_title": "结果: %0",
  "mcp.dialog.no_parameters": "此工具没有参数。",
  "mcp.dialog.run_tool": "运行工具",
  "mcp.dialog.copy_input": "复制输入",
  "mcp.dialog.cancel": "取消",
  "mcp.dialog.close": "关闭",
  "mcp.dialog.json_array_placeholder": "输入JSON数组，例如 [1, 2, 3]",
  "mcp.dialog.json_object_placeholder": "输入JSON对象",
  "mcp.dialog.input_copied": "输入已复制到剪贴板",
  "mcp.dialog.copy_failed": "复制到剪贴板失败",
  "mcp.dialog.running_tool": "正在运行工具...",
  "mcp.dialog.tool_not_found": "未找到工具 \"%0\"",

  // Prompt preview dialog
  "mcp.dialog.prompt_title": "提示词: %0",
  "mcp.dialog.copy": "复制",
  "mcp.dialog.prompt_copied": "提示词已复制到剪贴板",
  "mcp.dialog.no_arguments": "此提示词没有参数。",
  "mcp.dialog.generate_prompt": "生成提示词",
  "mcp.dialog.generating_prompt": "正在生成提示词...",
  "mcp.dialog.prompt_not_found": "未找到提示词 \"%0\"",
  "mcp.dialog.role_user": "用户",
  "mcp.dialog.role_assistant": "助手",

  // Prompt override dialog
  "mcp.dialog.edit_override": "编辑覆盖",
  "mcp.dialog.save_override": "保存覆盖",
  "mcp.dialog.reset_to_default": "重置为默认",
  "mcp.dialog.override_saved": "自定义提示词覆盖已保存",
  "mcp.dialog.override_reset": "提示词已重置为默认",
  "mcp.dialog.using_custom": "使用中: 自定义",
  "mcp.dialog.using_default": "使用中: 默认 (v%0)",
  "mcp.prompts.custom_badge": "自定义",
};

// All translations mapped by language code
const translations: Record<string, Record<string, string>> = {
  en,
  de,
  ja,
  zh,
};

/**
 * Registers all MCP plugin translations with Blockbench's language system.
 * Should be called during plugin setup.
 */
export function setupI18n(): void {
  // Always register English first as the fallback
  Language.addTranslations("en", en);

  // Register other languages
  for (const [langCode, strings] of Object.entries(translations)) {
    if (langCode !== "en") {
      Language.addTranslations(langCode, strings);
    }
  }
}

/**
 * Helper to format argument count with proper pluralization
 */
export function formatArgumentCount(count: number): string {
  if (count === 1) {
    return tl("mcp.prompts.argument_count", [count]);
  }
  return tl("mcp.prompts.argument_count_plural", [count]);
}
