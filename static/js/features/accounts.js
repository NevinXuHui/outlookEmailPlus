        // ==================== 账号相关 ====================

        // 选择账号
        function selectAccount(email) {
            currentAccount = email;
            isTempEmailGroup = false;
            currentFolder = 'inbox';
            currentMethod = 'graph';

            document.getElementById('currentAccountBar').style.display = '';
            document.getElementById('currentAccountEmail').textContent = email;

            // Update active state on account cards
            document.querySelectorAll('.account-card').forEach(item => {
                item.classList.remove('active');
                const emailEl = item.querySelector('.account-email');
                if (emailEl && emailEl.textContent.includes(email)) {
                    item.classList.add('active');
                }
            });

            // 窄屏下：回到列表态（避免上一次详情态残留）
            if (typeof setMailboxDetailFocus === 'function') {
                setMailboxDetailFocus(false);
            }

            const folderTabs = document.getElementById('folderTabs');
            if (folderTabs) {
                folderTabs.style.display = 'flex';
                document.querySelectorAll('.email-tab').forEach(tab => {
                    tab.classList.toggle('active', tab.dataset.folder === 'inbox');
                });
            }

            const cacheKey = `${email}_inbox`;

            if (emailListCache[cacheKey]) {
                const cache = emailListCache[cacheKey];
                currentEmails = (typeof sortEmailsByNewestFirst === 'function')
                    ? sortEmailsByNewestFirst(cache.emails || [])
                    : (cache.emails || []);
                hasMoreEmails = cache.has_more;
                currentSkip = cache.skip;
                currentMethod = cache.method || 'graph';

                cache.emails = currentEmails;

                const methodTag = document.getElementById('methodTag');
                methodTag.textContent = currentMethod;
                methodTag.style.display = 'inline';
                document.getElementById('emailCount').textContent = `(${currentEmails.length})`;

                renderEmailList(currentEmails);
            } else {
                document.getElementById('emailList').innerHTML = `
                    <div class="empty-state">
                        <span class="empty-icon">📬</span>
                        <p>${translateAppTextLocal('点击"获取邮件"按钮获取邮件')}</p>
                    </div>
                `;
                document.getElementById('emailCount').textContent = '';
                document.getElementById('methodTag').style.display = 'none';
                currentEmails = [];
            }

            document.getElementById('emailDetail').innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">📄</span>
                    <p>选择一封邮件查看详情</p>
                </div>
            `;
            document.getElementById('emailDetailToolbar').style.display = 'none';

            // 自动加载邮件列表（优先使用缓存，无缓存时自动 fetch）
            if (typeof loadEmails === 'function') {
                loadEmails(email);
            }

            // 标准模式：选中账号后自动启动轮询（如果轮询已启用且该账号尚未在轮询中）
            var view = typeof mailboxViewMode !== 'undefined' ? mailboxViewMode : 'standard';
            if (view !== 'compact' && typeof pollEnabled !== 'undefined' && pollEnabled && typeof startPoll === 'function') {
                // 如果该账号已在轮询中则跳过，避免重复启动和多余 Toast
                var alreadyPolling = typeof pollMap !== 'undefined' && pollMap.has(email);
                if (!alreadyPolling) {
                    startPoll(email);
                }
            }
        }

        // Provider 下拉缓存
        let providersLoaded = false;
        let providerOptions = [];

        function buildImportFailureToastMessage(data) {
            const baseMessage = pickApiMessage(data, data.message || '导入失败', data.message_en || 'Import failed');
            const summary = data && typeof data.summary === 'object' ? data.summary : null;
            const errors = Array.isArray(data && data.errors) ? data.errors : [];
            const lines = [baseMessage];

            if (summary) {
                const imported = Number(summary.imported || 0);
                const failed = Number(summary.failed || 0);
                const skipped = Number(summary.skipped || 0);
                lines.push(
                    getUiLanguage() === 'en'
                        ? `Imported ${imported}, failed ${failed}, skipped ${skipped}`
                        : `成功 ${imported}，失败 ${failed}，跳过 ${skipped}`
                );
            }

            if (errors.length > 0) {
                const firstError = errors[0] || {};
                const row = firstError.line_number || firstError.line || firstError.index;
                const detail = getUiLanguage() === 'en'
                    ? (firstError.message_en || firstError.message || firstError.error || '')
                    : (firstError.message || firstError.message_en || firstError.error || '');
                if (detail) {
                    lines.push(row ? (getUiLanguage() === 'en' ? `Line ${row}: ${detail}` : `第 ${row} 行：${detail}`) : detail);
                }
            }

            return lines.filter(Boolean).join('\n');
        }

        // 加载邮箱 providers（用于导入下拉）
        async function loadProviders() {
            if (providersLoaded) return;

            const select = document.getElementById('accountProvider');
            if (!select) return;

            try {
                const resp = await fetch('/api/providers');
                const data = await resp.json();
                if (!data.success || !Array.isArray(data.providers)) return;

                providerOptions = data.providers;
                select.innerHTML = data.providers.map(p => `
                    <option value="${escapeHtml(p.key)}">${escapeHtml(translateAppTextLocal(p.label || p.key))}</option>
                `).join('');

                providersLoaded = true;
            } catch (e) {
                // 静默失败：保留默认 Outlook 选项
            }
        }

        // Provider 切换：更新 placeholder / hint / custom IMAP 配置区显示
        function onProviderChange(provider) {
            const p = (provider || 'outlook').toLowerCase();
            const input = document.getElementById('accountInput');
            const hint = document.getElementById('accountFormatHint');
            const customFields = document.getElementById('customImapFields');
            const duplicateGroup = document.getElementById('duplicateStrategyGroup');
            const fallbackGroup = document.getElementById('fallbackImapGroup');
            const importGroupSelect = document.getElementById('importGroupSelect');

            if (!input || !hint || !customFields) return;

            // 重置 auto 模式特有的 UI
            if (duplicateGroup) duplicateGroup.style.display = 'none';
            if (fallbackGroup) fallbackGroup.style.display = 'none';
            if (importGroupSelect) {
                importGroupSelect.disabled = false;
            }

            if (p === 'auto') {
                customFields.style.display = 'none';
                if (duplicateGroup) duplicateGroup.style.display = '';
                if (fallbackGroup) fallbackGroup.style.display = '';
                input.placeholder = translateAppTextLocal('支持混合格式，每行一个账号...\nOutlook: 邮箱----密码----client_id----refresh_token（或反序）\nIMAP: 邮箱----授权码----provider\n或: 邮箱----密码（自动识别类型）\n临时邮箱: 仅邮箱地址');
                hint.textContent = translateAppTextLocal('智能识别模式：自动按每行格式和邮箱域名判断类型，自动分组');
                if (getTokenBtn) getTokenBtn.style.display = 'none';
                if (importGroupSelect) {
                    importGroupSelect.disabled = true;
                    const savedHTML = importGroupSelect.innerHTML;
                    importGroupSelect.dataset.savedOptions = savedHTML;
                    importGroupSelect.innerHTML = `<option value="">${translateAppTextLocal('自动按类型分组')}</option>`;
                }
                return;
            }

            // 恢复分组选择器（从 auto 切换回来时）
            if (importGroupSelect && importGroupSelect.dataset.savedOptions) {
                importGroupSelect.innerHTML = importGroupSelect.dataset.savedOptions;
                delete importGroupSelect.dataset.savedOptions;
            }

            if (p === 'outlook') {
                customFields.style.display = 'none';
                input.placeholder = translateAppTextLocal('邮箱----密码----client_id----refresh_token（或反序）');
                hint.textContent = translateAppTextLocal('Outlook 格式：支持两种顺序\n1) 邮箱----密码----client_id----refresh_token\n2) 邮箱----密码----refresh_token----client_id\n支持批量导入（每行一个）');
                return;
            }

            if (p === 'custom') {
                customFields.style.display = '';
                input.placeholder = translateAppTextLocal('邮箱----IMAP授权码/应用密码');
                hint.textContent = translateAppTextLocal('格式：邮箱----IMAP授权码/应用密码（每行一个）。自定义 IMAP 需填写上方服务器/端口；也支持：邮箱----授权码----imap_host----imap_port');
                return;
            }

            customFields.style.display = 'none';
            input.placeholder = translateAppTextLocal('邮箱----IMAP授权码/应用密码');
            hint.textContent = translateAppTextLocal('格式：邮箱----IMAP授权码/应用密码，支持批量导入（每行一个）');
        }

        // 文件导入状态
        let importSelectedFiles = [];
        let importInProgress = false;
        let importFileReading = false;
        const IMPORT_BATCH_SIZE = 50;
        const IMPORT_ACCEPTED_EXTS = ['.txt', '.csv'];

        function isImportBusy() {
            return importInProgress || importFileReading;
        }

        function setImportUiBusy(busy, options = {}) {
            const reading = Boolean(options && options.reading);
            if (reading) {
                importFileReading = Boolean(busy);
            } else {
                importInProgress = Boolean(busy);
            }
            const locked = isImportBusy();
            const submitBtn = document.getElementById('importSubmitBtn');
            const cancelBtn = document.getElementById('importCancelBtn');
            const fileInput = document.getElementById('importAccountFiles');
            const dropzone = document.getElementById('importFileDropzone');
            const accountInput = document.getElementById('accountInput');
            if (submitBtn) {
                submitBtn.disabled = locked;
                if (importInProgress) {
                    submitBtn.textContent = translateAppTextLocal('导入中...');
                } else if (importFileReading) {
                    submitBtn.textContent = translateAppTextLocal('读取中...');
                } else {
                    submitBtn.textContent = translateAppTextLocal('导入');
                }
            }
            if (cancelBtn) cancelBtn.disabled = importInProgress;
            if (fileInput) fileInput.disabled = locked;
            if (dropzone) dropzone.style.pointerEvents = locked ? 'none' : '';
            if (accountInput) accountInput.readOnly = importInProgress;
        }

        function resetImportProgress() {
            const group = document.getElementById('importProgressGroup');
            const fill = document.getElementById('importProgressFill');
            const text = document.getElementById('importProgressText');
            const count = document.getElementById('importProgressCount');
            if (group) group.style.display = 'none';
            if (fill) fill.style.width = '0%';
            if (text) text.textContent = translateAppTextLocal('准备导入…');
            if (count) count.textContent = '0 / 0';
        }

        function updateImportProgress(current, total, message) {
            const group = document.getElementById('importProgressGroup');
            const fill = document.getElementById('importProgressFill');
            const text = document.getElementById('importProgressText');
            const count = document.getElementById('importProgressCount');
            const safeTotal = Math.max(0, Number(total) || 0);
            const safeCurrent = Math.max(0, Math.min(Number(current) || 0, safeTotal || Number(current) || 0));
            const percent = safeTotal > 0 ? Math.min(100, Math.round((safeCurrent / safeTotal) * 100)) : 0;

            if (group) group.style.display = '';
            if (fill) fill.style.width = `${percent}%`;
            if (text) text.textContent = message || translateAppTextLocal('正在导入…');
            if (count) {
                count.textContent = safeTotal > 0
                    ? `${safeCurrent} / ${safeTotal}`
                    : `${safeCurrent}`;
            }
        }

        function formatImportFileSize(bytes) {
            const size = Number(bytes) || 0;
            if (size < 1024) return `${size} B`;
            if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
            return `${(size / (1024 * 1024)).toFixed(1)} MB`;
        }

        function isAcceptedImportFile(file) {
            if (!file || !file.name) return false;
            const name = String(file.name).toLowerCase();
            return IMPORT_ACCEPTED_EXTS.some((ext) => name.endsWith(ext));
        }

        function fileIdentity(file) {
            return `${file.name}::${file.size}::${file.lastModified || 0}`;
        }

        function renderImportFileList() {
            const listEl = document.getElementById('importFileList');
            if (!listEl) return;

            if (!importSelectedFiles.length) {
                listEl.style.display = 'none';
                listEl.innerHTML = '';
                return;
            }

            listEl.style.display = '';
            listEl.innerHTML = importSelectedFiles.map((file, index) => `
                <div class="import-file-item">
                    <span class="import-file-item-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
                    <span class="import-file-item-meta">${escapeHtml(formatImportFileSize(file.size))}</span>
                    <button type="button" class="import-file-item-remove" onclick="removeImportFile(${index})" title="${escapeHtml(translateAppTextLocal('移除'))}">×</button>
                </div>
            `).join('');
        }

        function clearImportFiles({ resetInput = true } = {}) {
            importSelectedFiles = [];
            renderImportFileList();
            if (resetInput) {
                const fileInput = document.getElementById('importAccountFiles');
                if (fileInput) fileInput.value = '';
            }
        }

        function removeImportFile(index) {
            if (isImportBusy()) return;
            if (index < 0 || index >= importSelectedFiles.length) return;
            importSelectedFiles.splice(index, 1);
            renderImportFileList();
            const fileInput = document.getElementById('importAccountFiles');
            if (fileInput) fileInput.value = '';
        }

        function handleImportFileDragOver(event) {
            if (isImportBusy()) return;
            event.preventDefault();
            event.stopPropagation();
            const dropzone = document.getElementById('importFileDropzone');
            if (dropzone) dropzone.classList.add('is-dragover');
        }

        function handleImportFileDragLeave(event) {
            event.preventDefault();
            event.stopPropagation();
            const dropzone = document.getElementById('importFileDropzone');
            if (dropzone) dropzone.classList.remove('is-dragover');
        }

        function handleImportFileDrop(event) {
            if (isImportBusy()) return;
            event.preventDefault();
            event.stopPropagation();
            const dropzone = document.getElementById('importFileDropzone');
            if (dropzone) dropzone.classList.remove('is-dragover');
            const files = event.dataTransfer && event.dataTransfer.files
                ? Array.from(event.dataTransfer.files)
                : [];
            if (files.length) {
                addImportFiles(files);
            }
        }

        function handleImportFilesSelected(event) {
            if (isImportBusy()) return;
            const files = event && event.target && event.target.files
                ? Array.from(event.target.files)
                : [];
            if (files.length) {
                addImportFiles(files);
            }
            // 允许重复选择同一文件
            if (event && event.target) {
                event.target.value = '';
            }
        }

        async function addImportFiles(files) {
            if (isImportBusy()) return;
            if (!Array.isArray(files) || !files.length) return;

            const existing = new Set(importSelectedFiles.map(fileIdentity));
            const accepted = [];
            const rejected = [];

            for (const file of files) {
                if (!isAcceptedImportFile(file)) {
                    rejected.push(file.name || translateAppTextLocal('未知文件'));
                    continue;
                }
                const id = fileIdentity(file);
                if (existing.has(id)) continue;
                existing.add(id);
                accepted.push(file);
            }

            if (rejected.length) {
                showToast(
                    `${translateAppTextLocal('部分文件已跳过')}：${rejected.slice(0, 3).join(', ')}${rejected.length > 3 ? '…' : ''}`,
                    'warning'
                );
            }
            if (!accepted.length) {
                if (!rejected.length) {
                    showToast(translateAppTextLocal('未选择有效文件'), 'warning');
                }
                return;
            }

            importSelectedFiles = importSelectedFiles.concat(accepted);
            renderImportFileList();
            // 仅读取本次新增文件，避免重复追加
            await loadImportFilesIntoTextarea(accepted);
        }

        function readImportFileAsText(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(reader.error || new Error('read failed'));
                reader.readAsText(file);
            });
        }

        function normalizeImportText(text) {
            return String(text || '')
                .replace(/^﻿/, '')
                .replace(/\r\n/g, '\n')
                .replace(/\r/g, '\n')
                .trim();
        }

        async function loadImportFilesIntoTextarea(filesToLoad) {
            const input = document.getElementById('accountInput');
            if (!input) return;

            const files = Array.isArray(filesToLoad) ? filesToLoad : importSelectedFiles;
            if (!files.length) {
                return;
            }

            setImportUiBusy(true, { reading: true });
            updateImportProgress(0, files.length, translateAppTextLocal('正在读取文件…'));
            try {
                const chunks = [];
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    updateImportProgress(
                        i,
                        files.length,
                        `${translateAppTextLocal('正在读取')}：${file.name}`
                    );
                    try {
                        const raw = await readImportFileAsText(file);
                        const normalized = normalizeImportText(raw);
                        if (normalized) {
                            chunks.push(`# ${file.name}`);
                            chunks.push(normalized);
                        }
                    } catch (err) {
                        showToast(
                            `${translateAppTextLocal('读取文件失败')}：${file.name}`,
                            'error'
                        );
                    }
                }

                const merged = chunks.join('\n\n').trim();
                if (merged) {
                    const existing = (input.value || '').trim();
                    input.value = existing ? `${existing}\n\n${merged}` : merged;
                }

                const lineCount = countImportableLines(input.value || '');
                updateImportProgress(
                    files.length,
                    files.length,
                    `${translateAppTextLocal('已加载')} ${importSelectedFiles.length} ${translateAppTextLocal('个文件')} · ${lineCount} ${translateAppTextLocal('行')}`
                );
            } finally {
                setImportUiBusy(false, { reading: true });
            }
        }

        function countImportableLines(text) {
            return splitImportLines(text).length;
        }

        function splitImportLines(text) {
            const rawLines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
            // 与后端 auto 导入一致：续行（无 ---- 且非注释）拼回上一行
            const merged = [];
            for (const raw of rawLines) {
                const stripped = (raw || '').trim();
                if (!stripped) continue;
                if (
                    merged.length
                    && !String(merged[merged.length - 1]).trimStart().startsWith('#')
                    && !stripped.includes('----')
                    && !stripped.startsWith('#')
                ) {
                    merged[merged.length - 1] += stripped;
                } else {
                    merged.push(stripped);
                }
            }
            return merged.filter((line) => line && !line.startsWith('#'));
        }

        function chunkImportLines(lines, batchSize) {
            const size = Math.max(1, Number(batchSize) || IMPORT_BATCH_SIZE);
            const batches = [];
            for (let i = 0; i < lines.length; i += size) {
                batches.push(lines.slice(i, i + size));
            }
            return batches;
        }

        function buildImportBasePayload(provider, groupId, addToPool, input) {
            const payload = {
                account_string: '',
                group_id: groupId,
                add_to_pool: addToPool,
            };

            if (provider === 'auto') {
                payload.provider = 'auto';
                payload.group_id = null;
                const strategyEl = document.querySelector('input[name="duplicateStrategy"]:checked');
                payload.duplicate_strategy = strategyEl ? strategyEl.value : 'skip';
                const fbHost = (document.getElementById('fallbackImapHost')?.value || '').trim();
                const fbPort = parseInt(document.getElementById('fallbackImapPort')?.value || '993', 10);
                if (fbHost) {
                    payload.imap_host = fbHost;
                    payload.imap_port = fbPort || 993;
                }
                return { payload, error: null };
            }

            if (provider && provider !== 'outlook') {
                payload.provider = provider;
                if (provider === 'custom') {
                    const host = (document.getElementById('imapHost')?.value || '').trim();
                    const portRaw = (document.getElementById('imapPort')?.value || '').trim();
                    const port = parseInt(portRaw || '993', 10) || 993;

                    if (!host) {
                        const lines = String(input || '').split('\n')
                            .map((l) => (l || '').trim())
                            .filter((l) => l && !l.startsWith('#'));
                        const hasInlineHost = lines.some((l) => (l.split('----').length >= 4));
                        if (!hasInlineHost) {
                            return {
                                payload: null,
                                error: translateAppTextLocal('请填写 IMAP 服务器地址（或在文本中每行包含 host/port）'),
                            };
                        }
                    } else {
                        payload.imap_host = host;
                        payload.imap_port = port;
                    }
                }
            }

            return { payload, error: null };
        }

        function mergeImportSummaries(target, source, provider) {
            if (!source || typeof source !== 'object') return target;
            target.imported += Number(source.imported || 0);
            target.failed += Number(source.failed || 0);
            target.skipped += Number(source.skipped || 0);

            if (source.by_provider && typeof source.by_provider === 'object') {
                for (const [prov, stats] of Object.entries(source.by_provider)) {
                    if (!target.by_provider[prov]) {
                        target.by_provider[prov] = { imported: 0, skipped: 0, failed: 0 };
                    }
                    target.by_provider[prov].imported += Number(stats.imported || 0);
                    target.by_provider[prov].skipped += Number(stats.skipped || 0);
                    target.by_provider[prov].failed += Number(stats.failed || 0);
                }
            }

            if (Array.isArray(source.groups_created)) {
                for (const name of source.groups_created) {
                    if (name && !target.groups_created.includes(name)) {
                        target.groups_created.push(name);
                    }
                }
            }

            if (provider === 'auto' || source.mode === 'auto') {
                target.mode = 'auto';
            }
            return target;
        }

        function appendImportErrors(targetErrors, sourceErrors, lineOffset) {
            if (!Array.isArray(sourceErrors) || !sourceErrors.length) return;
            for (const item of sourceErrors) {
                if (!item || typeof item !== 'object') continue;
                const cloned = { ...item };
                const rawLine = Number(item.line || item.line_number || item.index || 0);
                if (rawLine > 0) {
                    const absolute = rawLine + (Number(lineOffset) || 0);
                    cloned.line = absolute;
                    if (cloned.line_number != null) cloned.line_number = absolute;
                }
                targetErrors.push(cloned);
            }
        }

        async function postImportBatch(payload) {
            const response = await fetch('/api/accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            let data = null;
            try {
                data = await response.json();
            } catch (err) {
                data = null;
            }
            if (!data || typeof data !== 'object') {
                return {
                    success: false,
                    message: translateAppTextLocal('导入失败'),
                    message_en: 'Import failed',
                    summary: { imported: 0, failed: 0, skipped: 0 },
                    errors: [],
                };
            }
            return data;
        }

        // 显示添加账号模态框
        function showAddAccountModal() {
            document.getElementById('accountInput').value = '';
            const addToPoolCheckbox = document.getElementById('addToPoolCheckbox');
            if (addToPoolCheckbox) {
                addToPoolCheckbox.checked = false;
            }
            clearImportFiles();
            resetImportProgress();
            importFileReading = false;
            importInProgress = false;
            setImportUiBusy(false);
            // 设置默认分组为当前选中的分组
            if (currentGroupId) {
                document.getElementById('importGroupSelect').value = currentGroupId;
            }
            // 加载 providers 并初始化默认状态
            loadProviders().finally(() => {
                const sel = document.getElementById('accountProvider');
                if (sel) {
                    sel.value = 'outlook';
                    onProviderChange('outlook');
                } else {
                    onProviderChange('outlook');
                }

                const hostEl = document.getElementById('imapHost');
                const portEl = document.getElementById('imapPort');
                if (hostEl) hostEl.value = '';
                if (portEl) portEl.value = '993';

                // 重置 auto 模式的字段
                const fbHostEl = document.getElementById('fallbackImapHost');
                const fbPortEl = document.getElementById('fallbackImapPort');
                if (fbHostEl) fbHostEl.value = '';
                if (fbPortEl) fbPortEl.value = '993';
                const skipRadio = document.querySelector('input[name="duplicateStrategy"][value="skip"]');
                if (skipRadio) skipRadio.checked = true;
            });
            document.getElementById('addAccountModal').classList.add('show');
        }

        // 隐藏添加账号模态框
        function hideAddAccountModal(options = {}) {
            const force = Boolean(options && options.force);
            if (importInProgress && !force) {
                showToast(translateAppTextLocal('导入进行中，请稍候'), 'warning');
                return;
            }
            document.getElementById('addAccountModal').classList.remove('show');
            clearImportFiles();
            resetImportProgress();
            importFileReading = false;
            setImportUiBusy(false);
        }

        function resolveImportGroupId(rawGroupId) {
            return Number.isInteger(rawGroupId) && rawGroupId > 0 ? rawGroupId : null;
        }

        async function refreshMailboxAfterImport(provider, importedGroupId) {
            await loadGroups();

            if (currentPage !== 'mailbox') {
                return;
            }

            if (provider === 'auto') {
                if (!currentGroupId) {
                    const firstNormalGroup = groups.find(group => !isTempMailboxGroup(group));
                    if (firstNormalGroup) {
                        await selectGroup(firstNormalGroup.id);
                    }
                }
                return;
            }

            if (!importedGroupId) {
                if (currentGroupId) {
                    delete accountsCache[currentGroupId];
                    await loadAccountsByGroup(currentGroupId, true);
                }
                return;
            }

            delete accountsCache[importedGroupId];
            await selectGroup(importedGroupId);
        }

        // 添加账号（支持多文件合并文本 + 分批导入进度）
        async function addAccount() {
            if (isImportBusy()) return;

            const input = document.getElementById('accountInput').value.trim();
            const groupId = parseInt(document.getElementById('importGroupSelect').value);
            const providerEl = document.getElementById('accountProvider');
            const provider = providerEl ? (providerEl.value || 'outlook') : 'outlook';
            const addToPool = Boolean(document.getElementById('addToPoolCheckbox')?.checked);
            const importedGroupId = resolveImportGroupId(groupId);

            if (!input) {
                showToast(translateAppTextLocal('请输入账号信息'), 'error');
                return;
            }

            const lines = splitImportLines(input);
            if (!lines.length) {
                showToast(translateAppTextLocal('请输入账号信息'), 'error');
                return;
            }

            const built = buildImportBasePayload(provider, groupId, addToPool, input);
            if (built.error) {
                showToast(built.error, 'error');
                return;
            }

            const batches = chunkImportLines(lines, IMPORT_BATCH_SIZE);
            const totalLines = lines.length;
            let processedLines = 0;
            let lineOffset = 0;
            const aggregate = {
                imported: 0,
                failed: 0,
                skipped: 0,
                by_provider: {},
                groups_created: [],
                mode: provider === 'auto' ? 'auto' : undefined,
            };
            const allErrors = [];
            let lastData = null;
            let anySuccess = false;
            let hardError = null;

            setImportUiBusy(true);
            updateImportProgress(0, totalLines, translateAppTextLocal('开始导入…'));

            try {
                for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
                    const batchLines = batches[batchIndex];
                    const payload = {
                        ...built.payload,
                        account_string: batchLines.join('\n'),
                    };

                    updateImportProgress(
                        processedLines,
                        totalLines,
                        `${translateAppTextLocal('正在导入')} ${processedLines + 1}-${Math.min(processedLines + batchLines.length, totalLines)} / ${totalLines}`
                    );

                    const data = await postImportBatch(payload);
                    lastData = data;

                    if (data.summary || data.success) {
                        mergeImportSummaries(aggregate, data.summary || {
                            imported: data.success ? batchLines.length : 0,
                            failed: data.success ? 0 : batchLines.length,
                            skipped: 0,
                        }, provider);
                    } else if (!data.success) {
                        // 整批失败时按失败计入，避免进度“空转”
                        aggregate.failed += batchLines.length;
                    }

                    appendImportErrors(allErrors, data.errors, lineOffset);

                    if (data.success) {
                        anySuccess = true;
                    } else if (!data.summary && !Array.isArray(data.errors)) {
                        hardError = data;
                        // 非结构化错误：中断后续批次，避免重复冲击
                        processedLines += batchLines.length;
                        lineOffset += batchLines.length;
                        break;
                    }

                    processedLines += batchLines.length;
                    lineOffset += batchLines.length;
                    updateImportProgress(
                        processedLines,
                        totalLines,
                        `${translateAppTextLocal('已处理')} ${processedLines} / ${totalLines}`
                    );
                }

                const fallbackZh = `导入完成：成功 ${aggregate.imported} 个，失败 ${aggregate.failed} 个`
                    + (aggregate.skipped ? `，跳过 ${aggregate.skipped} 个` : '');
                const fallbackEn = `Import completed: ${aggregate.imported} succeeded, ${aggregate.failed} failed`
                    + (aggregate.skipped ? `, ${aggregate.skipped} skipped` : '');

                // 与 auto 后端一致：有成功/跳过即视为整体成功（可伴随部分失败）
                const overallSuccess = Boolean(
                    anySuccess && (aggregate.imported > 0 || aggregate.skipped > 0 || aggregate.failed === 0)
                );

                const resultPayload = {
                    success: overallSuccess,
                    message: (lastData && lastData.message) || (overallSuccess ? fallbackZh : translateAppTextLocal('导入失败')),
                    message_en: (lastData && lastData.message_en) || (overallSuccess ? fallbackEn : 'Import failed'),
                    summary: {
                        ...aggregate,
                        total: totalLines,
                        mode: aggregate.mode || (provider === 'auto' ? 'auto' : undefined),
                    },
                    errors: allErrors.slice(0, 50),
                    error: hardError && hardError.error ? hardError.error : undefined,
                };

                if (hardError && !anySuccess && !(hardError.summary || Array.isArray(hardError.errors))) {
                    handleApiError(hardError, '导入邮箱失败');
                    updateImportProgress(processedLines, totalLines, translateAppTextLocal('导入失败'));
                    return;
                }

                if (resultPayload.success) {
                    if (resultPayload.summary && resultPayload.summary.mode === 'auto') {
                        let msg = pickApiMessage(resultPayload, resultPayload.message, resultPayload.message_en || 'Import completed');
                        const s = resultPayload.summary;
                        if (s.by_provider && Object.keys(s.by_provider).length > 0) {
                            msg += `\n\n--- ${translateAppTextLocal('按类型统计')} ---`;
                            const provNames = {
                                outlook: 'Outlook', gmail: 'Gmail', qq: 'QQ邮箱', '163': '163邮箱',
                                '126': '126邮箱', yahoo: 'Yahoo', aliyun: '阿里云邮箱',
                                custom: '自定义IMAP', temp_mail: '临时邮箱', gptmail: '临时邮箱',
                            };
                            for (const [prov, stats] of Object.entries(s.by_provider)) {
                                const name = provNames[prov] || prov;
                                msg += `\n${translateAppTextLocal(name)}: ${translateAppTextLocal('成功')} ${stats.imported || 0}`;
                                if (stats.skipped) msg += `, ${translateAppTextLocal('跳过')} ${stats.skipped}`;
                                if (stats.failed) msg += `, ${translateAppTextLocal('失败')} ${stats.failed}`;
                            }
                        }
                        if (s.groups_created && s.groups_created.length > 0) {
                            msg += `\n\n✨ ${translateAppTextLocal('自动创建分组')}：${s.groups_created.join('、')}`;
                        }
                        showToast(msg, aggregate.failed > 0 ? 'warning' : 'success');
                    } else {
                        showToast(
                            pickApiMessage(resultPayload, resultPayload.message || fallbackZh, resultPayload.message_en || fallbackEn),
                            aggregate.failed > 0 ? 'warning' : 'success'
                        );
                    }

                    updateImportProgress(totalLines, totalLines, translateAppTextLocal('导入完成'));
                    // force：导入结束收尾，避免被 importInProgress 拦截
                    hideAddAccountModal({ force: true });

                    if (typeof accountsCache !== 'undefined') {
                        if (provider === 'auto') {
                            for (const key in accountsCache) { delete accountsCache[key]; }
                        } else if (importedGroupId) {
                            delete accountsCache[importedGroupId];
                        }
                    }

                    await refreshMailboxAfterImport(provider, importedGroupId);
                } else if (resultPayload.summary || Array.isArray(resultPayload.errors)) {
                    showToast(buildImportFailureToastMessage(resultPayload), 'error', resultPayload.error || resultPayload);
                    updateImportProgress(processedLines, totalLines, translateAppTextLocal('导入失败'));
                } else {
                    handleApiError(resultPayload, '导入邮箱失败');
                    updateImportProgress(processedLines, totalLines, translateAppTextLocal('导入失败'));
                }
            } catch (error) {
                showToast(translateAppTextLocal('添加失败'), 'error');
                updateImportProgress(processedLines, totalLines, translateAppTextLocal('导入失败'));
            } finally {
                setImportUiBusy(false);
            }
        }

        // 显示编辑账号模态框
        async function showEditAccountModal(accountId) {
            try {
                const response = await fetch(`/api/accounts/${accountId}`);
                const data = await response.json();

                if (data.success) {
                    const acc = data.account;
                    const isImap = (acc.account_type || 'outlook') === 'imap';
                    const clientIdInput = document.getElementById('editClientId');
                    const refreshTokenInput = document.getElementById('editRefreshToken');

                    document.getElementById('editAccountId').value = acc.id;
                    document.getElementById('editAccountType').value = acc.account_type || 'outlook';
                    document.getElementById('editEmail').value = acc.email;
                    document.getElementById('editPassword').value = acc.password || '';
                    clientIdInput.value = acc.client_id;
                    clientIdInput.dataset.originalValue = acc.client_id || '';
                    refreshTokenInput.value = acc.refresh_token;
                    document.getElementById('editGroupSelect').value = acc.group_id || 1;
                    document.getElementById('editRemark').value = acc.remark || '';
                    document.getElementById('editStatus').value = acc.status || 'active';

                    // IMAP 账号：隐藏 Client ID / Refresh Token，调整密码标签
                    const clientIdGroup = document.getElementById('editClientIdGroup');
                    const refreshTokenGroup = document.getElementById('editRefreshTokenGroup');
                    const passwordLabel = document.getElementById('editPasswordLabel');

                    if (isImap) {
                        clientIdGroup.style.display = 'none';
                        refreshTokenGroup.style.display = 'none';
                        passwordLabel.textContent = translateAppTextLocal('授权码 / 应用密码');
                        document.getElementById('editPassword').placeholder = translateAppTextLocal('留空则不修改');
                        refreshTokenInput.placeholder = '';
                    } else {
                        clientIdGroup.style.display = '';
                        refreshTokenGroup.style.display = '';
                        passwordLabel.textContent = translateAppTextLocal('密码');
                        document.getElementById('editPassword').placeholder = translateAppTextLocal('可选，留空则不修改');
                        refreshTokenInput.placeholder = translateAppTextLocal('留空则不修改');
                    }

                    document.getElementById('editAccountModal').classList.add('show');
                }
            } catch (error) {
                showToast(translateAppTextLocal('加载账号信息失败'), 'error');
            }
        }

        // 隐藏编辑账号模态框
        function hideEditAccountModal() {
            document.getElementById('editAccountModal').classList.remove('show');
        }

        function focusEditRemarkField() {
            const remarkField = document.getElementById('editRemark');
            if (!remarkField) {
                return;
            }
            remarkField.focus();
            remarkField.setSelectionRange(remarkField.value.length, remarkField.value.length);
        }

        async function showEditRemarkOnly(accountId) {
            await showEditAccountModal(accountId);
            focusEditRemarkField();
        }

        async function updateAccountRemarkOnly() {
            const accountId = document.getElementById('editAccountId').value;
            const remark = document.getElementById('editRemark').value.trim();

            if (!accountId) {
                showToast(translateAppTextLocal('未找到账号'), 'error');
                return;
            }

            try {
                const response = await fetch(`/api/accounts/${accountId}/remark`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ remark })
                });

                const result = await response.json();
                if (!result.success) {
                    handleApiError(result, '备注更新失败');
                    return;
                }

                showToast(pickApiMessage(result, result.message, 'Remark updated successfully'), 'success');

                if (currentGroupId) {
                    delete accountsCache[currentGroupId];
                    loadAccountsByGroup(currentGroupId, true);
                }
            } catch (error) {
                showToast(translateAppTextLocal('备注更新失败'), 'error');
            }
        }

        // 更新账号
        async function updateAccount() {
            const accountId = document.getElementById('editAccountId').value;
            const accountType = document.getElementById('editAccountType').value || 'outlook';
            const isImap = accountType === 'imap';
            const oldGroupId = currentGroupId;
            const newGroupId = parseInt(document.getElementById('editGroupSelect').value);
            const clientIdInput = document.getElementById('editClientId');
            const refreshTokenInput = document.getElementById('editRefreshToken');
            const clientId = clientIdInput.value.trim();
            const refreshToken = refreshTokenInput.value.trim();
            const originalClientId = (clientIdInput.dataset.originalValue || '').trim();
            const hasClientIdChanged = !isImap && clientId !== originalClientId;
            const wantsToUpdateOutlookCredentials = !isImap && (hasClientIdChanged || !!refreshToken);

            const data = {
                email: document.getElementById('editEmail').value.trim(),
                password: document.getElementById('editPassword').value,
                client_id: wantsToUpdateOutlookCredentials ? clientId : '',
                refresh_token: wantsToUpdateOutlookCredentials ? refreshToken : '',
                group_id: newGroupId,
                remark: document.getElementById('editRemark').value.trim(),
                status: document.getElementById('editStatus').value
            };

            if (!data.email) {
                showToast(translateAppTextLocal('邮箱地址不能为空'), 'error');
                return;
            }

            // 仅在用户真正修改 Outlook 凭据时，才要求提交完整凭据对
            if (wantsToUpdateOutlookCredentials && (!data.client_id || !data.refresh_token)) {
                showToast(translateAppTextLocal('邮箱、Client ID 和 Refresh Token 不能为空'), 'error');
                return;
            }

            try {
                const response = await fetch(`/api/accounts/${accountId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });

                const result = await response.json();

                if (result.success) {
                    showToast(pickApiMessage(result, result.message, 'Account updated successfully'), 'success');
                    hideEditAccountModal();

                    // 清除相关分组的缓存
                    delete accountsCache[oldGroupId];
                    if (oldGroupId !== newGroupId) {
                        delete accountsCache[newGroupId];
                    }

                    // 刷新分组列表
                    loadGroups();

                    // 刷新当前分组的邮箱列表
                    if (currentGroupId) {
                        loadAccountsByGroup(currentGroupId, true);
                    }
                } else {
                    handleApiError(result, '更新失败');
                }
            } catch (error) {
                showToast(translateAppTextLocal('更新失败'), 'error');
            }
        }

        // 删除当前编辑的账号
        async function deleteCurrentAccount() {
            const accountId = document.getElementById('editAccountId').value;
            const email = document.getElementById('editEmail').value;
            const groupId = parseInt(document.getElementById('editGroupSelect').value);

            if (!confirm(`确定要删除账号 ${email} 吗？`)) {
                return;
            }

            try {
                const response = await fetch(`/api/accounts/${accountId}`, { method: 'DELETE' });
                const data = await response.json();

                if (data.success) {
                    showToast(pickApiMessage(data, '删除成功', 'Deleted successfully'), 'success');
                    hideEditAccountModal();

                    // 清除缓存
                    delete accountsCache[groupId];

                    if (currentAccount === email) {
                        currentAccount = null;
                        document.getElementById('currentAccountBar').style.display = 'none';
                        document.getElementById('emailList').innerHTML = `
                            <div class="empty-state">
                                <span class="empty-icon">📬</span><p>请从左侧选择一个邮箱账号</p>
                            </div>
                        `;
                        document.getElementById('emailDetail').innerHTML = `
                            <div class="empty-state">
                                <span class="empty-icon">📄</span><p>选择一封邮件查看详情</p>
                            </div>
                        `;
                    }

                    // 刷新分组列表
                    loadGroups();

                    // 刷新当前分组的邮箱列表
                    if (currentGroupId) {
                        loadAccountsByGroup(currentGroupId, true);
                    }
                }
            } catch (error) {
                showToast(translateAppTextLocal('删除失败'), 'error');
            }
        }

        // 切换账号状态（启用/停用）
        async function toggleAccountStatus(accountId, currentStatus) {
            const newStatus = currentStatus === 'inactive' ? 'active' : 'inactive';
            const successFallbackZh = newStatus === 'inactive' ? '停用成功' : '启用成功';
            const successFallbackEn = newStatus === 'inactive' ? 'Disabled successfully' : 'Enabled successfully';
            const failureFallbackZh = newStatus === 'inactive' ? '停用账号失败' : '启用账号失败';

            try {
                const response = await fetch(`/api/accounts/${accountId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: newStatus })
                });

                const data = await response.json();

                if (data.success) {
                    showToast(pickApiMessage(data, successFallbackZh, successFallbackEn), 'success');

                    // 清除当前分组的缓存
                    if (currentGroupId) {
                        delete accountsCache[currentGroupId];
                        loadAccountsByGroup(currentGroupId, true);
                    }
                } else {
                    handleApiError(data, failureFallbackZh);
                }
            } catch (error) {
                showToast(translateAppTextLocal(failureFallbackZh), 'error');
            }
        }

        // 删除账号（快捷方式）
        async function deleteAccount(accountId, email) {
            if (!confirm(`确定要删除账号 ${email} 吗？`)) {
                return;
            }

            try {
                const response = await fetch(`/api/accounts/${accountId}`, { method: 'DELETE' });
                const data = await response.json();

                if (data.success) {
                    showToast(pickApiMessage(data, '删除成功', 'Deleted successfully'), 'success');

                    // 清除当前分组的缓存
                    if (currentGroupId) {
                        delete accountsCache[currentGroupId];
                    }

                    if (currentAccount === email) {
                        currentAccount = null;
                        document.getElementById('currentAccountBar').style.display = 'none';
                        document.getElementById('emailList').innerHTML = `
                            <div class="empty-state">
                                <span class="empty-icon">📬</span><p>请从左侧选择一个邮箱账号</p>
                            </div>
                        `;
                        document.getElementById('emailDetail').innerHTML = `
                            <div class="empty-state">
                                <span class="empty-icon">📄</span><p>选择一封邮件查看详情</p>
                            </div>
                        `;
                    }

                    // 刷新分组列表
                    loadGroups();

                    // 刷新当前分组的邮箱列表
                    if (currentGroupId) {
                        loadAccountsByGroup(currentGroupId, true);
                    }
                } else {
                    handleApiError(data, '删除账号失败');
                }
            } catch (error) {
                showToast(translateAppTextLocal('删除失败'), 'error');
            }
        }

        // 批量切换账号通知参与开关（Issue #64）
        async function batchNotificationToggle(enabled) {
            if (selectedAccountIds.size === 0) {
                showToast(translateAppTextLocal('请选择要批量操作通知的账号'), 'error');
                return;
            }
            const ids = Array.from(selectedAccountIds);
            try {
                const response = await fetch('/api/accounts/batch-notification-toggle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ account_ids: ids, enabled })
                });
                const data = await response.json();
                if (data.success) {
                    showToast(
                        data.message || (enabled ? translateAppTextLocal('批量开启通知完成') : translateAppTextLocal('批量关闭通知完成')),
                        'success'
                    );
                    if (currentGroupId) {
                        delete accountsCache[currentGroupId];
                        loadAccountsByGroup(currentGroupId, true);
                    }
                } else {
                    handleApiError(data, translateAppTextLocal('批量操作失败'));
                }
            } catch (error) {
                showToast(translateAppTextLocal('操作失败'), 'error');
            }
        }

        // 切换账号通知参与开关（沿用旧 Telegram 接口）
        async function toggleTelegramPush(accountId, enabled) {
            try {
                const response = await fetch(`/api/accounts/${accountId}/telegram-toggle`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled })
                });
                const data = await response.json();
                if (data.success) {
                    showToast(
                        pickApiMessage(
                            data,
                            data.message || (enabled ? '该邮箱通知参与已开启' : '该邮箱通知参与已关闭'),
                            enabled ? 'Mailbox notifications enabled' : 'Mailbox notifications disabled'
                        ),
                        'success'
                    );
                    if (currentGroupId) {
                        delete accountsCache[currentGroupId];
                        loadAccountsByGroup(currentGroupId, true);
                    }
                } else {
                    handleApiError(data, '通知参与切换失败');
                }
            } catch (error) {
                showToast(translateAppTextLocal('操作失败'), 'error');
            }
        }

        // 显示导出邮箱模态框
        async function showExportModal() {
            document.getElementById('exportModal').classList.add('show');
            await loadExportGroupList();
        }

        // 隐藏导出邮箱模态框
        function hideExportModal() {
            document.getElementById('exportModal').classList.remove('show');
        }

        // 加载导出分组列表
        async function loadExportGroupList() {
            const container = document.getElementById('exportGroupList');
            container.innerHTML = '<div class="loading-overlay"><span class="spinner"></span></div>';

            try {
                if (groups.length === 0) {
                    container.innerHTML = '<div class="empty-state"><p>暂无分组</p></div>';
                } else {
                    container.innerHTML = groups.map(group => `
                        <label style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; cursor: pointer; border-radius: var(--radius); transition: background-color 0.15s;"
                               onmouseover="this.style.backgroundColor='var(--bg-hover)'"
                               onmouseout="this.style.backgroundColor='transparent'">
                            <input type="checkbox" class="export-group-checkbox" value="${group.id}">
                            <span style="display: flex; align-items: center; gap: 8px; flex: 1;">
                                <span class="group-color-dot" style="background-color: ${group.color || '#666'}"></span>
                                <span style="font-size: 0.9rem; color: var(--text);">${escapeHtml(group.name)}</span>
                            </span>
                            <span class="badge-count">${group.account_count || 0}</span>
                        </label>
                    `).join('');
                }
            } catch (error) {
                container.innerHTML = `<div class="empty-state"><p style="color:var(--clr-danger)">${translateAppTextLocal('加载失败')}</p></div>`;
            }

            document.getElementById('selectAllGroups').checked = false;
        }

        // 全选/取消全选分组
        function toggleSelectAllGroups() {
            const selectAll = document.getElementById('selectAllGroups').checked;
            document.querySelectorAll('.export-group-checkbox').forEach(cb => {
                cb.checked = selectAll;
            });
        }

        // 存储待导出的分组ID
        let pendingExportGroupIds = [];

        // 导出选中的分组
        async function exportSelectedGroups() {
            const checkboxes = document.querySelectorAll('.export-group-checkbox:checked');
            const groupIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

            if (groupIds.length === 0) {
                showToast(translateAppTextLocal('请选择要导出的分组'), 'error');
                return;
            }

            // 保存待导出的分组ID
            pendingExportGroupIds = groupIds;

            // 显示密码确认对话框
            hideExportModal();
            showExportVerifyModal();
        }

        // 显示导出密码确认对话框
        function showExportVerifyModal() {
            document.getElementById('exportVerifyModal').classList.add('show');
            document.getElementById('exportVerifyPassword').value = '';
            document.getElementById('exportVerifyPassword').focus();
        }

        // 隐藏导出密码确认对话框
        function hideExportVerifyModal() {
            document.getElementById('exportVerifyModal').classList.remove('show');
            document.getElementById('exportVerifyPassword').value = '';
        }

        // 确认导出验证
        async function confirmExportVerify() {
            const password = document.getElementById('exportVerifyPassword').value;

            if (!password) {
                showToast(translateAppTextLocal('请输入密码'), 'error');
                return;
            }

            try {
                // 获取验证token
                const verifyResponse = await fetch('/api/export/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                });

                const verifyData = await verifyResponse.json();

                if (!verifyData.success) {
                    handleApiError(verifyData, '密码错误');
                    if (verifyData.need_verify) {
                        document.getElementById('exportVerifyPassword').focus();
                    }
                    return;
                }

                const verifyToken = verifyData.verify_token;

                // 执行导出（使用请求头传递 token，避免 URL/日志泄露）
                const response = await fetch('/api/accounts/export-selected', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Export-Token': verifyToken
                    },
                    body: JSON.stringify({
                        group_ids: pendingExportGroupIds
                    })
                });

                if (response.ok) {
                    // 获取文件名
                    const contentDisposition = response.headers.get('Content-Disposition');
                    let filename = 'accounts.txt';
                    if (contentDisposition) {
                        const match = contentDisposition.match(/filename\*?=(?:UTF-8'')?([^;\n]+)/i);
                        if (match) {
                            filename = decodeURIComponent(match[1]);
                        }
                    }

                    // 下载文件
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);

                    showToast(translateAppTextLocal('导出成功'), 'success');
                    hideExportVerifyModal();
                } else {
                    const data = await response.json();
                    handleApiError(data, '导出失败');
                    if (data.need_verify) {
                        document.getElementById('exportVerifyPassword').focus();
                    }
                }
            } catch (error) {
                showToast(translateAppTextLocal('导出失败'), 'error');
            }
        }

