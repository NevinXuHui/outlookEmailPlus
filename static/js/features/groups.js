        // ==================== 分组相关 ====================

        // 加载分组列表
        async function loadGroups() {
            const container = document.getElementById('groupList');
            container.innerHTML = `<div class="loading-overlay"><span class="spinner"></span> ${translateAppTextLocal('加载中…')}</div>`;

            try {
                const response = await fetch('/api/groups');
                const data = await response.json();

                if (data.success) {
                    groups = data.groups;

                    // 找到临时邮箱分组
                    const tempGroup = groups.find(g => g.name === '临时邮箱');
                    if (tempGroup) {
                        tempEmailGroupId = tempGroup.id;
                    }

                    renderGroupList(data.groups);
                    if (typeof renderCompactGroupStrip === 'function') {
                        renderCompactGroupStrip(data.groups, currentGroupId);
                    }
                    updateGroupSelects();

                    // 如果之前选中了分组，保持选中状态并刷新邮箱列表
                    if (currentGroupId) {
                        const group = groups.find(g => g.id === currentGroupId);
                        if (group) {
                            // 刷新当前分组的邮箱列表
                            if (currentGroupId === tempEmailGroupId) {
                                loadTempEmails(true);
                            } else {
                                await loadAccountsByGroup(currentGroupId, true);
                            }
                        }
                    } else if (currentPage !== 'temp-emails') {
                        // BUG-06 防御：在临时邮箱页面时，不自动选组。
                        // 自动选组会调用 selectGroup()，进而清空 currentAccount，
                        // 导致用户在临时邮箱页选中的邮箱被意外重置。
                        // 仅在其他页面（mailbox/dashboard 等）才执行首次自动选组。
                        const firstNormalGroup = groups.find(g => !isTempMailboxGroup(g));
                        if (firstNormalGroup) {
                            selectGroup(firstNormalGroup.id);
                        }
                    }
                }
            } catch (error) {
                container.innerHTML = `<div class="empty-state"><p>${translateAppTextLocal('加载失败')}</p></div>`;
                showToast(translateAppTextLocal('加载分组失败'), 'error');
            }
        }

        // 渲染分组列表
        function renderGroupList(groups) {
            const container = document.getElementById('groupList');

            // 过滤掉临时邮箱分组（已有独立页面管理）
            const filteredGroups = groups.filter(g => !isTempMailboxGroup(g));

            if (filteredGroups.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <span class="empty-icon">📁</span>
                        <p>${translateAppTextLocal('暂无分组')}</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = filteredGroups.map(group => {
                const isSystem = group.is_system === 1;
                const isDefault = group.id === 1;

                return `
                    <div class="group-item ${currentGroupId === group.id ? 'active' : ''}"
                         data-group-id="${group.id}"
                         onclick="selectGroup(${group.id})">
                        <span class="group-color-dot" style="background-color: ${group.color || '#666'}"></span>
                        <span class="group-name">${escapeHtml(group.name)}</span>
                        <span class="badge-count">${group.account_count || 0}</span>
                        <div class="group-actions">
                            ${!isSystem ? `<button class="btn-icon" onclick="event.stopPropagation(); editGroup(${group.id})" title="编辑">✏️</button>` : ''}
                            ${!isDefault && !isSystem ? `<button class="btn-icon" onclick="event.stopPropagation(); deleteGroup(${group.id})" title="删除">🗑️</button>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }

        // 选择分组
        async function selectGroup(groupId) {
            currentGroupId = groupId;
            currentAccountPage = 1;  // 切换分组时重置到第 1 页
            currentAccountSearchQuery = '';
            showAnomaliesOnly = false;  // 切换分组时重置异常筛选
            if (typeof clearGlobalAccountListCache === 'function') {
                clearGlobalAccountListCache();
            }

            // 切换分组时停止所有正在运行的轮询（避免跨分组轮询堆积）
            if (typeof stopAllPolls === 'function') {
                stopAllPolls();
            }

            // 清空搜索框
            const searchInput = document.getElementById('globalSearch');
            if (searchInput) {
                searchInput.value = '';
            }

            // 重置异常筛选复选框（标准模式 + 简洁模式）
            syncAnomalyFilterCheckboxes(false);

            // 重置右侧邮件列 UI（清除上一个分组的残留状态）
            currentAccount = null;
            const accountBar = document.getElementById('currentAccountBar');
            if (accountBar) accountBar.style.display = 'none';
            const emailListEl = document.getElementById('emailList');
            if (emailListEl) emailListEl.innerHTML = '<div class="empty-state"><span class="empty-icon">📬</span><p>请从左侧选择一个邮箱账号</p></div>';
            const detailSection = document.getElementById('emailDetailSection');
            if (detailSection) detailSection.style.display = 'none';
            const folderTabs = document.getElementById('folderTabs');
            if (folderTabs) folderTabs.style.display = 'none';
            const emailCount = document.getElementById('emailCount');
            if (emailCount) emailCount.textContent = '';
            const methodTag = document.getElementById('methodTag');
            if (methodTag) methodTag.style.display = 'none';

            // 检查是否是临时邮箱分组
            const group = groups.find(g => g.id === groupId);
            isTempEmailGroup = Boolean(group && isTempMailboxGroup(group));

            // 更新分组列表 UI
            document.querySelectorAll('.group-item').forEach(item => {
                item.classList.toggle('active', parseInt(item.dataset.groupId) === groupId);
            });
            if (typeof renderCompactGroupStrip === 'function') {
                renderCompactGroupStrip(groups, groupId);
            }

            // 更新邮箱面板标题
            if (group) {
                document.getElementById('currentGroupName').textContent = formatGroupDisplayName(group.name);
                document.getElementById('currentGroupColor').style.backgroundColor = group.color || '#666';

                // 更新导入邮箱时的默认分组
                const importSelect = document.getElementById('importGroupSelect');
                if (importSelect) {
                    importSelect.value = groupId;
                }
            }

            // 更新底部按钮
            updateAccountPanelFooter();

            // 加载该分组的邮箱
            if (isTempEmailGroup) {
                // 临时邮箱已有独立页面，跳转到专属页面管理
                navigate('temp-emails');
                return;
            } else {
                // 切换分组：加载账号列表（不启动批量轮询）
                await loadAccountsByGroup(groupId);
            }
        }

        // 更新账号面板底部按钮（新布局无独立footer，通过topbar按钮实现）
        function updateAccountPanelFooter() {
            // No-op: new layout uses topbar action buttons instead
        }

        // 加载账号列表：有搜索词时跨全部分组；无搜索词时按分组
        async function loadAccountsByGroup(groupId, forceRefresh = false, page = currentAccountPage) {
            const container = document.getElementById('accountList');
            const cacheKey = resolveAccountListCacheKey(groupId);
            // 全局搜索时不传 group_id；分组浏览时使用指定分组
            const queryGroupId = isGlobalAccountSearchActive() ? null : groupId;

            // 保存当前滚动位置（forceRefresh 时恢复）
            const savedScrollTop = forceRefresh && container ? container.scrollTop : 0;
            const queryKey = buildAccountListQueryKey(queryGroupId, page);
            const cachedMeta = accountListMetaCache[cacheKey];

            // 如果有缓存且不强制刷新，直接使用缓存
            if (!forceRefresh && Array.isArray(accountsCache[cacheKey]) && cachedMeta && cachedMeta.queryKey === queryKey) {
                currentAccountPage = Number(cachedMeta.page || page || 1);
                renderAccountList(accountsCache[cacheKey]);
                if (typeof renderCompactAccountList === 'function') {
                    renderCompactAccountList(accountsCache[cacheKey]);
                }
                updateAccountListHeaderForSearch();
                // 标准模式：不再在加载分组时批量启动轮询
                // 轮询仅在用户选中单个账号时启动（selectAccount 中处理）
                // 这避免了首次加载、导航切换、分组切换时的 N×4 并发 API 请求
                return;
            }

            // forceRefresh 时不显示 loading（保持旧内容，静默刷新）
            if (!forceRefresh && container) {
                const loadingText = isGlobalAccountSearchActive()
                    ? translateAppTextLocal('搜索中…')
                    : translateAppTextLocal('加载中…');
                container.innerHTML = `<div class="loading-overlay"><span class="spinner"></span> ${loadingText}</div>`;
                if (typeof renderCompactLoadingState === 'function') {
                    renderCompactLoadingState(loadingText);
                }
            }

            try {
                const response = await fetch(`/api/accounts?${queryKey}`);
                const data = await response.json();

                if (data.success) {
                    updateAccountListCache(groupId, data.accounts, data.pagination, queryKey);
                    const cachedAccounts = accountsCache[cacheKey] || [];
                    renderAccountList(cachedAccounts);
                    if (typeof renderCompactAccountList === 'function') {
                        renderCompactAccountList(cachedAccounts);
                    }
                    updateAccountListHeaderForSearch();
                    // 恢复滚动位置
                    if (forceRefresh && container) {
                        requestAnimationFrame(() => { container.scrollTop = savedScrollTop; });
                    }
                    // 标准模式：不再在加载分组时批量启动轮询
                    // 轮询仅在用户选中单个账号时启动（selectAccount 中处理）
                    // 这避免了首次加载、导航切换、分组切换时的 N×4 并发 API 请求
                }
            } catch (error) {
                if (container) {
                    container.innerHTML = `<div class="empty-state"><p>${translateAppTextLocal('加载失败')}</p></div>`;
                }
                if (typeof renderCompactErrorState === 'function') {
                    renderCompactErrorState(translateAppTextLocal('加载失败'));
                }
            }
        }

        // 获取 provider 的中文展示名（账号卡片 tag）
        function getProviderLabel(provider) {
            const key = (provider || 'outlook').toString().toLowerCase();
            const labels = {
                outlook: 'Outlook',
                gmail: 'Gmail',
                qq: 'QQ 邮箱',
                '163': '163 邮箱',
                '126': '126 邮箱',
                yahoo: 'Yahoo 邮箱',
                aliyun: '阿里邮箱',
                custom: '自定义 IMAP',
                cloudflare_temp_mail: 'CF 临时邮箱'
            };
            return translateAppTextLocal(labels[key] || provider || '未知');
        }

        // 渲染邮箱列表
        function renderAccountList(accounts) {
            const container = document.getElementById('accountList');
            const globalSearch = isGlobalAccountSearchActive();

            if (!accounts || accounts.length === 0) {
                const emptyText = globalSearch
                    ? translateAppTextLocal('未找到匹配的邮箱')
                    : translateAppTextLocal('该分组暂无邮箱');
                container.innerHTML = `
                    <div class="empty-state">
                        <span class="empty-icon">📭</span>
                        <p>${emptyText}</p>
                    </div>
                `;
                const selectAllCheckbox = document.getElementById('selectAllCheckbox');
                if (selectAllCheckbox) {
                    selectAllCheckbox.checked = false;
                    selectAllCheckbox.indeterminate = selectedAccountIds.size > 0;
                }
                updateBatchActionBar();
                return;
            }

            const pagination = getAccountListMeta();
            const totalAccounts = Number(pagination.total_count || 0);
            const totalPages = Number(pagination.total_pages || 0);
            currentAccountPage = Number(pagination.page || 1);
            const pageAccounts = Array.isArray(accounts) ? accounts : [];
            const avatarGradients = [
                ['#B85C38', '#E8734A'],  // 砖红→珊瑚
                ['#3A7D44', '#5BAF6A'],  // 翠绿→嫩绿
                ['#2E6B8A', '#4BA3CC'],  // 海蓝→天蓝
                ['#8B5E3C', '#C8963E'],  // 棕→琥珀金
                ['#7B4F9B', '#B77FD8'],  // 紫罗兰→薰衣草
                ['#C75050', '#E88080'],  // 朱红→浅红
                ['#2C7A7B', '#4DC9C9'],  // 青绿→薄荷
                ['#9B6B3E', '#D4A65A'],  // 赭石→沙金
            ];

            container.innerHTML = pageAccounts.map((acc, index) => {
                const isChecked = selectedAccountIds.has(acc.id);
                const initial = (acc.email || '?')[0].toUpperCase();
                const supportsTokenRefresh = isRefreshableOutlookAccount(acc);
                const isFailed = supportsTokenRefresh && acc.last_refresh_status === 'failed';
                const defaultMethodLabel = supportsTokenRefresh ? 'Graph' : 'IMAP';
                const gradient = avatarGradients[index % avatarGradients.length];
                const providerLabel = getProviderLabel(acc.provider || acc.account_type || 'outlook');
                const providerTagHtml = `<span class="account-provider-tag">${escapeHtml(providerLabel)}</span>`;
                const groupName = acc.group_name || translateAppTextLocal('默认分组');
                const groupColor = acc.group_color || '#666666';
                const groupTagHtml = globalSearch
                    ? `<span class="tag" style="background-color:${escapeHtml(groupColor)};color:white;" title="${escapeHtml(translateAppTextLocal('所属分组'))}">📁 ${escapeHtml(groupName)}</span>`
                    : '';
                const notificationEnabled = acc.notification_enabled !== undefined
                    ? !!acc.notification_enabled
                    : !!acc.telegram_push_enabled;
                const isCfPoolAccount = String(acc.provider || '').toLowerCase() === 'cloudflare_temp_mail';

                let tokenBadge = `<span class="badge badge-gray">IMAP</span>`;
                if (supportsTokenRefresh) {
                    tokenBadge = `<span class="badge badge-gray">– ${translateAppTextLocal('未知')}</span>`;
                    if (acc.token_status === 'valid') {
                        tokenBadge = `<span class="badge badge-green">✓ ${translateAppTextLocal('有效')}</span>`;
                    } else if (acc.token_status === 'invalid' || acc.token_status === 'expired') {
                        tokenBadge = `<span class="badge badge-red">✗ ${translateAppTextLocal('过期')}</span>`;
                    } else if (acc.token_status === 'expiring') {
                        tokenBadge = `<span class="badge badge-gold">⚠ ${translateAppTextLocal('即将过期')}</span>`;
                    }
                }

                return `
                <div class="account-card ${currentAccount === acc.email ? 'active' : ''}"
                     onclick="selectAccount('${escapeJs(acc.email)}')">
                    <div class="account-token-badge">${tokenBadge}</div>
                    <div class="account-card-top">
                        <input type="checkbox" class="account-select-checkbox" value="${acc.id}"
                               ${isChecked ? 'checked' : ''}
                               onclick="event.stopPropagation()"
                               onchange="event.stopPropagation(); handleAccountSelectionChange(${acc.id}, this.checked)">
                        <div class="account-avatar" style="background: linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})">${initial}</div>
                        <div class="account-info">
                            <div class="account-email"
                                 onclick="event.stopPropagation(); copyEmail('${escapeJs(acc.email)}')"
                                 title="${escapeHtml(translateAppTextLocal('点击复制邮箱地址'))}"
                                 style="${isFailed ? 'color:var(--clr-danger);' : ''}cursor:pointer;">
                                ${escapeHtml(acc.email)}
                            </div>
                            ${acc.remark && acc.remark.trim() ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">📝 ${escapeHtml(translateAppTextLocal('备注'))}: ${escapeHtml(acc.remark)}</div>` : ''}
                            <div style="display:flex;flex-wrap:wrap;gap:3px;margin-top:3px;">
                                ${providerTagHtml}
                                ${groupTagHtml}
                                ${(acc.tags || []).map(tag => `<span class="tag" style="background-color:${tag.color};color:white;">${escapeHtml(tag.name)}</span>`).join('')}
                                ${notificationEnabled ? `<span class="tag tg-push-tag" onclick="event.stopPropagation(); toggleTelegramPush(${acc.id}, false)" title="${escapeHtml(translateAppTextLocal('点击关闭该邮箱通知参与'))}">🔔 ${escapeHtml(translateAppTextLocal('通知'))}</span>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="account-card-bottom">
                        <div class="account-meta">
                            <span class="account-api-tag">${acc.method || defaultMethodLabel}</span>
                            <span>🕐 ${formatRelativeTime(acc.last_refresh_at)}</span>
                            ${isFailed ? `<button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); showRefreshError(${acc.id}, '${escapeJs(acc.last_refresh_error || '未知错误')}', '${escapeJs(acc.email)}', '${escapeJs(acc.account_type || 'outlook')}', '${escapeJs(acc.provider || 'outlook')}')" style="padding:1px 6px;font-size:0.65rem;">${escapeHtml(translateAppTextLocal('查看错误'))}</button>` : ''}
                        </div>
                        <div class="account-actions">
                            <button class="btn-icon ${notificationEnabled ? 'tg-push-active' : ''}" onclick="event.stopPropagation(); toggleTelegramPush(${acc.id}, ${!notificationEnabled})" title="${escapeHtml(translateAppTextLocal(notificationEnabled ? '该邮箱通知参与（已开启）' : '开启该邮箱通知参与'))}">🔔</button>
                            <button class="btn btn-sm btn-accent" onclick="event.stopPropagation(); copyVerificationInfo('${escapeJs(acc.email)}', this)" title="${escapeHtml(translateAppTextLocal('验证码'))}" style="font-size:0.72rem;padding:2px 8px;">🔑 ${escapeHtml(translateAppTextLocal('验证码'))}</button>
                            <button class="btn-icon" onclick="event.stopPropagation(); copyEmail('${escapeJs(acc.email)}')" title="${escapeHtml(translateAppTextLocal('复制'))}">📋</button>
                            ${isCfPoolAccount
                                ? `<button class="btn-icon" disabled title="${escapeHtml(translateAppTextLocal('邮箱池管理的账号不支持编辑'))}" style="opacity:0.3;cursor:not-allowed;">✏️</button>`
                                : `<button class="btn-icon" onclick="event.stopPropagation(); showEditAccountModal(${acc.id})" title="${escapeHtml(translateAppTextLocal('编辑'))}">✏️</button>`
                            }
                            ${isCfPoolAccount
                                ? `<button class="btn-icon" disabled title="${escapeHtml(translateAppTextLocal('邮箱池管理的账号不支持手动删除'))}" style="opacity:0.3;cursor:not-allowed;color:var(--clr-danger);">🗑️</button>`
                                : `<button class="btn-icon" onclick="event.stopPropagation(); deleteAccount(${acc.id}, '${escapeJs(acc.email)}')" title="${escapeHtml(translateAppTextLocal('删除'))}" style="color:var(--clr-danger);">🗑️</button>`
                            }
                        </div>
                    </div>
                </div>
            `}).join('');

            // ===== 增强的分页控件：显示页码按钮、快速跳转等功能 =====
            if (totalPages > 1) {
                const paginationEl = document.createElement('div');
                paginationEl.className = 'account-pagination';
                paginationEl.style.cssText = 'display:flex;flex-direction:column;gap:12px;align-items:center;margin-top:16px;padding:12px;background:var(--bg-primary);border-radius:8px;';
                
                // 第一行：页码信息和快速跳转
                const infoRow = `
                    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:center;width:100%;">
                        <span style="color:var(--text-muted);font-size:0.85rem;">
                            ${translateAppTextLocal('共')} <strong style="color:var(--primary);">${totalAccounts}</strong> ${translateAppTextLocal('个账号')} · 
                            ${translateAppTextLocal('第')} <strong style="color:var(--primary);">${currentAccountPage}</strong> / ${totalPages} ${translateAppTextLocal('页')}
                        </span>
                        <div style="display:flex;gap:4px;align-items:center;">
                            <span style="color:var(--text-muted);font-size:0.85rem;">${translateAppTextLocal('跳转至')}</span>
                            <input type="number" id="quickJumpInput" min="1" max="${totalPages}" 
                                placeholder="${currentAccountPage}"
                                style="width:60px;height:28px;padding:2px 6px;border:1px solid var(--border);border-radius:4px;text-align:center;font-size:0.85rem;"
                                onkeypress="if(event.key==='Enter') quickJumpToPage()"
                            />
                            <button onclick="quickJumpToPage()" 
                                style="height:28px;padding:2px 12px;background:var(--primary);color:white;border:none;border-radius:4px;cursor:pointer;font-size:0.85rem;transition:opacity 0.2s;"
                                onmouseover="this.style.opacity='0.8'"
                                onmouseout="this.style.opacity='1'"
                            >${translateAppTextLocal('跳转')}</button>
                        </div>
                    </div>
                `;
                
                // 第二行：上一页、页码按钮、下一页
                const paginationButtons = buildAccountPagination(currentAccountPage, totalPages);
                const navRow = `
                    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:center;">
                        <button class="page-btn page-btn-prev"
                                onclick="goToAccountPage(${currentAccountPage - 1})"
                                style="min-width:70px;height:32px;padding:4px 12px;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:0.85rem;transition:all 0.2s;display:flex;align-items:center;gap:4px;justify-content:center;"
                                ${currentAccountPage <= 1 ? 'disabled' : ''}
                                onmouseover="if(!this.disabled) this.style.background='var(--bg-hover)'"
                                onmouseout="if(!this.disabled) this.style.background='var(--bg-secondary)'"
                        >
                            <span>◀</span>
                            <span>${translateAppTextLocal('上一页')}</span>
                        </button>
                        ${paginationButtons}
                        <button class="page-btn page-btn-next"
                                onclick="goToAccountPage(${currentAccountPage + 1})"
                                style="min-width:70px;height:32px;padding:4px 12px;background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:0.85rem;transition:all 0.2s;display:flex;align-items:center;gap:4px;justify-content:center;"
                                ${currentAccountPage >= totalPages ? 'disabled' : ''}
                                onmouseover="if(!this.disabled) this.style.background='var(--bg-hover)'"
                                onmouseout="if(!this.disabled) this.style.background='var(--bg-secondary)'"
                        >
                            <span>${translateAppTextLocal('下一页')}</span>
                            <span>▶</span>
                        </button>
                    </div>
                `;
                
                paginationEl.innerHTML = infoRow + navRow;
                container.appendChild(paginationEl);
            }

            updateSelectAllCheckbox();
            updateBatchActionBar();
            // 如果有正在运行的轮询，重新显示轮询指示器（账号列表重渲染后会丢失绿点）
            if (typeof reapplyAllPollUI === 'function') {
                reapplyAllPollUI();
            }
        }

        // 构建增强的分页导航（显示页码按钮）
        function buildAccountPagination(current, total) {
            if (total <= 1) return '';

            const delta = 2; // 当前页前后各显示多少页
            const range = [];
            const left = Math.max(2, current - delta);
            const right = Math.min(total - 1, current + delta);

            // 始终显示首页
            range.push(1);
            
            // 如果左边界不是紧邻首页，添加省略号
            if (left > 2) range.push('...');
            
            // 添加当前页附近的页码
            for (let i = left; i <= right; i++) {
                range.push(i);
            }
            
            // 如果右边界不是紧邻末页，添加省略号
            if (right < total - 1) range.push('...');
            
            // 始终显示末页
            if (total > 1) range.push(total);

            return range.map(p => {
                if (p === '...') {
                    return `<span style="color:var(--text-muted);padding:0 6px;font-size:0.9rem;">…</span>`;
                }
                const active = p === current;
                const btnStyle = active 
                    ? 'background:var(--primary);color:white;border-color:var(--primary);font-weight:600;' 
                    : 'background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border);';
                return `<button class="page-number-btn" 
                    onclick="goToAccountPage(${p})" 
                    style="${btnStyle}min-width:32px;height:32px;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:0.85rem;transition:all 0.2s;"
                    ${active ? 'disabled' : ''}
                    onmouseover="if(!this.disabled) this.style.background='var(--bg-hover)'"
                    onmouseout="if(!this.disabled) this.style.background='var(--bg-secondary)'"
                >${p}</button>`;
            }).join('');
        }

        // 跳转到指定账号分页（支持全局搜索结果分页）
        function goToAccountPage(page) {
            if (!isGlobalAccountSearchActive() && (currentGroupId === null || currentGroupId === undefined)) {
                return;
            }
            const totalPages = Number(getAccountListMeta().total_pages || 0);
            if (page < 1 || page > totalPages) return;
            currentAccountPage = page;
            loadAccountsByGroup(currentGroupId, false, page);
            const containers = [
                document.getElementById('accountList'),
                document.getElementById('compactAccountList')
            ].filter(Boolean);
            containers.forEach(container => {
                container.scrollTop = 0;
            });
        }
        
        // 快速跳转到指定页
        function quickJumpToPage() {
            const input = document.getElementById('quickJumpInput');
            if (!input) return;
            const page = parseInt(input.value, 10);
            const totalPages = Number(getAccountListMeta().total_pages || 0);
            if (isNaN(page) || page < 1 || page > totalPages) {
                showToast(translateAppTextLocal('请输入有效的页码 (1-${total})').replace('${total}', totalPages), 'warning');
                return;
            }
            goToAccountPage(page);
        }

        // 排序相关变量
        let currentSortBy = 'refresh_time';
        let currentSortOrder = 'asc';

        // 账号列表分页状态
        let currentAccountPage = 1;
        const ACCOUNT_PAGE_SIZE = 50;
        let currentAccountSearchQuery = '';
        const accountListMetaCache = {};
        // 全局搜索结果使用独立缓存键，避免污染分组缓存
        const GLOBAL_ACCOUNT_LIST_KEY = '__global__';

        // 异常筛选状态
        let showAnomaliesOnly = false;

        function isGlobalAccountSearchActive() {
            return Boolean(String(currentAccountSearchQuery || '').trim());
        }

        function resolveAccountListCacheKey(groupId = currentGroupId) {
            return isGlobalAccountSearchActive() ? GLOBAL_ACCOUNT_LIST_KEY : groupId;
        }

        function clearGlobalAccountListCache() {
            delete accountsCache[GLOBAL_ACCOUNT_LIST_KEY];
            delete accountListMetaCache[GLOBAL_ACCOUNT_LIST_KEY];
        }

        function updateAccountListHeaderForSearch() {
            const nameEl = document.getElementById('currentGroupName');
            const colorEl = document.getElementById('currentGroupColor');
            const compactSummary = document.getElementById('compactModeSummary');

            if (isGlobalAccountSearchActive()) {
                const title = translateAppTextLocal('全局搜索');
                if (nameEl) nameEl.textContent = title;
                if (colorEl) colorEl.style.backgroundColor = 'var(--primary, #4A90D9)';
                if (compactSummary) compactSummary.textContent = title;
                return;
            }

            const group = groups.find(g => g.id === currentGroupId);
            if (group) {
                const displayName = formatGroupDisplayName(group.name);
                if (nameEl) nameEl.textContent = displayName;
                if (colorEl) colorEl.style.backgroundColor = group.color || '#666';
                if (compactSummary) compactSummary.textContent = displayName;
            } else if (!currentGroupId) {
                if (nameEl) nameEl.textContent = translateAppTextLocal('选择分组');
                if (colorEl) colorEl.style.backgroundColor = '#666';
                if (compactSummary) compactSummary.textContent = translateAppTextLocal('请选择分组');
            }
        }

        function getSelectedTagFilterIds() {
            return Array.from(document.querySelectorAll('.tag-filter-checkbox:checked'))
                .map(cb => parseInt(cb.value, 10))
                .filter(tagId => Number.isInteger(tagId) && tagId > 0);
        }

        function buildAccountListQueryKey(groupId, page = currentAccountPage) {
            const params = new URLSearchParams();
            // 全局搜索时不带 group_id，跨全部分组检索
            if (!isGlobalAccountSearchActive() && groupId !== null && groupId !== undefined) {
                params.set('group_id', String(groupId));
            }
            params.set('page', String(page || 1));
            params.set('page_size', String(ACCOUNT_PAGE_SIZE));
            params.set('sort_by', currentSortBy);
            params.set('sort_order', currentSortOrder);

            const normalizedSearch = String(currentAccountSearchQuery || '').trim();
            if (normalizedSearch) {
                params.set('search', normalizedSearch);
            }

            getSelectedTagFilterIds().forEach(tagId => {
                params.append('tag_id', String(tagId));
            });

            // 添加异常筛选参数
            if (typeof showAnomaliesOnly !== 'undefined' && showAnomaliesOnly) {
                params.set('show_anomalies', 'true');
            }

            return params.toString();
        }

        function getAccountListMeta(groupId = currentGroupId) {
            const cacheKey = resolveAccountListCacheKey(groupId);
            const cachedMeta = accountListMetaCache[cacheKey];
            if (cachedMeta) {
                return cachedMeta;
            }
            const fallbackAccounts = Array.isArray(accountsCache[cacheKey]) ? accountsCache[cacheKey] : [];
            return {
                page: currentAccountPage,
                page_size: ACCOUNT_PAGE_SIZE,
                total_count: fallbackAccounts.length,
                total_pages: fallbackAccounts.length > 0 ? 1 : 0,
                queryKey: ''
            };
        }

        function updateAccountListCache(groupId, accounts, pagination, queryKey) {
            const cacheKey = resolveAccountListCacheKey(groupId);
            const safeAccounts = Array.isArray(accounts) ? accounts : [];
            const safePagination = pagination && typeof pagination === 'object'
                ? pagination
                : { page: currentAccountPage || 1, page_size: ACCOUNT_PAGE_SIZE, total_count: safeAccounts.length, total_pages: safeAccounts.length > 0 ? 1 : 0 };

            accountsCache[cacheKey] = safeAccounts;
            accountListMetaCache[cacheKey] = {
                page: Number(safePagination.page || 1),
                page_size: Number(safePagination.page_size || ACCOUNT_PAGE_SIZE),
                total_count: Number(safePagination.total_count || 0),
                total_pages: Number(safePagination.total_pages || 0),
                queryKey
            };
            currentAccountPage = Number(accountListMetaCache[cacheKey].page || 1);
        }

        // 排序账号列表
        function sortAccounts(sortBy) {
            // 如果点击同一个排序按钮，切换排序顺序
            if (currentSortBy === sortBy) {
                currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
            } else {
                currentSortBy = sortBy;
                currentSortOrder = sortBy === 'refresh_time' ? 'asc' : 'asc';
            }

            // 更新按钮状态
            document.querySelectorAll('.sort-btn').forEach(btn => {
                btn.classList.remove('active');
            });

            const activeBtn = document.querySelector(`[data-sort="${sortBy}"]`);
            if (activeBtn) {
                activeBtn.classList.add('active');
            }

            if (isGlobalAccountSearchActive() || currentGroupId) {
                currentAccountPage = 1;  // 排序时重置到第 1 页
                loadAccountsByGroup(currentGroupId, true, 1);
            }
        }

        function syncAnomalyFilterCheckboxes(checked) {
            const standard = document.getElementById('showAnomaliesCheckbox');
            const compact = document.getElementById('compactShowAnomaliesCheckbox');
            if (standard) standard.checked = Boolean(checked);
            if (compact) compact.checked = Boolean(checked);
        }

        function setShowAnomaliesOnly(enabled, { reload = true } = {}) {
            showAnomaliesOnly = Boolean(enabled);
            syncAnomalyFilterCheckboxes(showAnomaliesOnly);
            if (reload && (isGlobalAccountSearchActive() || currentGroupId)) {
                currentAccountPage = 1;
                loadAccountsByGroup(currentGroupId, true, 1);
            }
        }

        // 切换异常邮箱筛选（标准模式）
        function toggleShowAnomalies() {
            const checkbox = document.getElementById('showAnomaliesCheckbox');
            setShowAnomaliesOnly(checkbox ? checkbox.checked : false);
        }

        // 切换异常邮箱筛选（简洁模式）
        function toggleShowAnomaliesFromCompact() {
            const checkbox = document.getElementById('compactShowAnomaliesCheckbox');
            setShowAnomaliesOnly(checkbox ? checkbox.checked : false);
        }

        // 应用筛选和排序
        function applyFiltersAndSort(accounts) {
            return Array.isArray(accounts) ? [...accounts] : [];
        }

        // Tag Filter Change Handler
        function handleTagFilterChange() {
            if (isGlobalAccountSearchActive() || currentGroupId) {
                currentAccountPage = 1;  // 标签过滤时重置到第 1 页
                loadAccountsByGroup(currentGroupId, true, 1);
            }
        }

        // 防抖函数
        function debounce(func, wait) {
            let timeout;
            return function (...args) {
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(this, args), wait);
            };
        }

        // 全局搜索函数：有关键词时跨全部分组；清空后回到当前分组
        async function searchAccounts(query) {
            const container = document.getElementById('accountList');
            currentAccountSearchQuery = String(query || '').trim();
            currentAccountPage = 1;

            if (!currentAccountSearchQuery) {
                clearGlobalAccountListCache();
                updateAccountListHeaderForSearch();
                if (currentGroupId) {
                    await loadAccountsByGroup(currentGroupId, true, 1);
                } else if (container) {
                    container.innerHTML = `
                        <div class="empty-state">
                            <span class="empty-icon">📁</span>
                            <p>${translateAppTextLocal('请从左侧选择一个分组')}</p>
                        </div>
                    `;
                    if (typeof renderCompactErrorState === 'function') {
                        renderCompactErrorState(translateAppTextLocal('请选择分组'));
                    }
                }
                return;
            }

            // 切换到全局搜索时丢弃旧缓存，确保使用无 group_id 的查询
            clearGlobalAccountListCache();
            updateAccountListHeaderForSearch();

            if (container) {
                container.innerHTML = `<div class="loading-overlay"><span class="spinner"></span> ${translateAppTextLocal('搜索中…')}</div>`;
            }
            if (typeof renderCompactLoadingState === 'function') {
                renderCompactLoadingState(translateAppTextLocal('搜索中…'));
            }

            try {
                await loadAccountsByGroup(currentGroupId, true, 1);
            } catch (error) {
                console.error('搜索失败:', error);
                if (container) {
                    container.innerHTML = `<div class="empty-state"><p>${translateAppTextLocal('搜索失败，请重试')}</p></div>`;
                }
                if (typeof renderCompactErrorState === 'function') {
                    renderCompactErrorState(translateAppTextLocal('搜索失败，请重试'));
                }
            }
        }

        // 更新分组下拉选择框
        function updateGroupSelects() {
            const selects = ['importGroupSelect', 'editGroupSelect'];
            selects.forEach(selectId => {
                const select = document.getElementById(selectId);
                if (select) {
                    const currentValue = select.value;
                    // 过滤掉临时邮箱分组（导入邮箱时不能选择临时邮箱分组）
                    const filteredGroups = selectId === 'importGroupSelect'
                        ? groups.filter(g => g.name !== '临时邮箱')
                        : groups;

                    select.innerHTML = filteredGroups.map(g =>
                        `<option value="${g.id}">${escapeHtml(g.name)}</option>`
                    ).join('');
                    // 恢复之前的选择
                    if (currentValue && filteredGroups.find(g => g.id === parseInt(currentValue))) {
                        select.value = currentValue;
                    } else if (currentGroupId && filteredGroups.find(g => g.id === currentGroupId)) {
                        select.value = currentGroupId;
                    }
                }
            });
        }

        // 显示添加分组模态框
        function showAddGroupModal() {
            editingGroupId = null;
            document.getElementById('groupModalTitle').textContent = translateAppTextLocal('添加分组');
            document.getElementById('groupName').value = '';
            document.getElementById('groupDescription').value = '';
            selectedColor = '#B85C38';
            document.querySelectorAll('.color-option').forEach(o => {
                o.classList.toggle('selected', o.dataset.color === selectedColor);
            });
            document.getElementById('customColorInput').value = selectedColor;
            document.getElementById('customColorHex').value = selectedColor;
            document.getElementById('groupProxyUrl').value = '';
            document.getElementById('groupVerificationCodeLength').value = '6-6';
            document.getElementById('groupVerificationCodeRegex').value = '';
            document.getElementById('addGroupModal').classList.add('show');
        }

        // 隐藏添加分组模态框
        function hideAddGroupModal() {
            document.getElementById('addGroupModal').classList.remove('show');
        }

        // 编辑分组
        async function editGroup(groupId) {
            try {
                const response = await fetch(`/api/groups/${groupId}`);
                const data = await response.json();

                if (data.success) {
                    editingGroupId = groupId;
                    document.getElementById('groupModalTitle').textContent = translateAppTextLocal('编辑分组');
                    document.getElementById('groupName').value = data.group.name;
                    document.getElementById('groupDescription').value = data.group.description || '';
                    selectedColor = data.group.color || '#B85C38';

                    // 检查是否是预设颜色
                    let isPresetColor = false;
                    document.querySelectorAll('.color-option').forEach(o => {
                        if (o.dataset.color === selectedColor) {
                            o.classList.add('selected');
                            isPresetColor = true;
                        } else {
                            o.classList.remove('selected');
                        }
                    });

                    // 更新自定义颜色输入框
                    document.getElementById('customColorInput').value = selectedColor;
                    document.getElementById('customColorHex').value = selectedColor;

                    // 填充代理设置
                    document.getElementById('groupProxyUrl').value = data.group.proxy_url || '';

                    // 回填验证码提取策略
                    document.getElementById('groupVerificationCodeLength').value = data.group.verification_code_length || '6-6';
                    document.getElementById('groupVerificationCodeRegex').value = data.group.verification_code_regex || '';

                    document.getElementById('addGroupModal').classList.add('show');
                }
            } catch (error) {
                showToast(translateAppTextLocal('加载分组信息失败'), 'error');
            }
        }

        // 保存分组
        async function saveGroup() {
            const name = document.getElementById('groupName').value.trim();
            const description = document.getElementById('groupDescription').value.trim();
            const verificationCodeLength = document.getElementById('groupVerificationCodeLength')?.value?.trim() || '6-6';
            const verificationCodeRegex = document.getElementById('groupVerificationCodeRegex')?.value?.trim() || '';

            if (!name) {
                showToast(translateAppTextLocal('请输入分组名称'), 'error');
                return;
            }

            try {
                const url = editingGroupId ? `/api/groups/${editingGroupId}` : '/api/groups';
                const method = editingGroupId ? 'PUT' : 'POST';

                const response = await fetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name,
                        description,
                        color: selectedColor,
                        proxy_url: document.getElementById('groupProxyUrl').value.trim(),
                        verification_code_length: verificationCodeLength,
                        verification_code_regex: verificationCodeRegex
                    })
                });

                const data = await response.json();

                if (data.success) {
                    showToast(pickApiMessage(data, data.message, 'Group saved successfully'), 'success');
                    hideAddGroupModal();
                    loadGroups();
                } else {
                    handleApiError(data, '保存分组失败');
                }
            } catch (error) {
                showToast(translateAppTextLocal('保存失败'), 'error');
            }
        }

        // 删除分组
        async function deleteGroup(groupId) {
            if (!confirm('确定要删除该分组吗？分组下的所有邮箱也将被删除，此操作不可恢复！')) {
                return;
            }

            try {
                const response = await fetch(`/api/groups/${groupId}`, { method: 'DELETE' });
                const data = await response.json();

                if (data.success) {
                    showToast(pickApiMessage(data, data.message, 'Group deleted successfully'), 'success');
                    // 清除缓存
                    delete accountsCache[groupId];
                    // 如果删除的是当前选中的分组，切换到默认分组
                    if (currentGroupId === groupId) {
                        currentGroupId = 1;
                    }
                    loadGroups();
                } else {
                    handleApiError(data, '删除分组失败');
                }
            } catch (error) {
                showToast(translateAppTextLocal('删除失败'), 'error');
            }
        }

        // ==================== 全选功能 ====================

        function getSelectAllMenus() {
            return [
                document.getElementById('selectAllMenu'),
                document.getElementById('compactSelectAllMenu')
            ].filter(Boolean);
        }

        function closeSelectAllMenus() {
            getSelectAllMenus().forEach(menu => {
                menu.open = false;
            });
        }

        function openSelectAllMenu() {
            const menu = mailboxViewMode === 'compact'
                ? document.getElementById('compactSelectAllMenu')
                : document.getElementById('selectAllMenu');
            if (!menu) {
                return;
            }
            getSelectAllMenus().forEach(item => {
                item.open = item === menu;
            });
        }

        // 全选/取消全选账号（当前分组）
        // 勾选时弹出「当前页 / 全部」；取消勾选时清空全部选中
        function toggleSelectAll(event) {
            const selectAllCheckbox = mailboxViewMode === 'compact'
                ? document.getElementById('compactSelectAllCheckbox')
                : document.getElementById('selectAllCheckbox');
            if (!selectAllCheckbox) {
                return;
            }

            if (selectAllCheckbox.checked) {
                // 先回退勾选状态，待用户选择范围后再更新
                selectAllCheckbox.checked = false;
                selectAllCheckbox.indeterminate = selectedAccountIds.size > 0;
                openSelectAllMenu();
                if (event) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            } else {
                closeSelectAllMenus();
                unselectAllAccounts();
            }
        }

        function buildCurrentGroupAccountFilterParams({ includeAnomalies = true } = {}) {
            const params = new URLSearchParams();
            // 全局搜索时不限分组；否则跟随当前分组
            if (!isGlobalAccountSearchActive() && currentGroupId !== null && currentGroupId !== undefined) {
                params.set('group_id', String(currentGroupId));
            }

            const normalizedSearch = String(currentAccountSearchQuery || '').trim();
            if (normalizedSearch) {
                params.set('search', normalizedSearch);
            }
            getSelectedTagFilterIds().forEach(tagId => {
                params.append('tag_id', String(tagId));
            });
            if (includeAnomalies && typeof showAnomaliesOnly !== 'undefined' && showAnomaliesOnly) {
                params.set('show_anomalies', 'true');
            }
            return params;
        }

        async function fetchCurrentGroupAccountIds({ includeAnomalies = true } = {}) {
            const params = buildCurrentGroupAccountFilterParams({ includeAnomalies });
            const response = await fetch(`/api/accounts/all-ids?${params.toString()}`);
            const data = await response.json();
            if (!data.success || !Array.isArray(data.account_ids)) {
                throw new Error((data && (data.message || data.error)) || 'fetch account ids failed');
            }
            return data.account_ids
                .map((accountId) => Number(accountId))
                .filter((id) => Number.isInteger(id) && id > 0);
        }

        // 全选当前结果集全部账号（跨页；全局搜索时跨分组，否则限当前分组）
        async function selectAllAccountsInGroup() {
            closeSelectAllMenus();
            if (!isGlobalAccountSearchActive() && (currentGroupId === null || currentGroupId === undefined)) {
                showToast(translateAppTextLocal('请先选择分组'), 'error');
                return;
            }

            try {
                const accountIds = await fetchCurrentGroupAccountIds({ includeAnomalies: true });

                // 用服务端完整 ID 列表覆盖选中集合
                selectedAccountIds.clear();
                accountIds.forEach((id) => selectedAccountIds.add(id));

                // 更新当前页面的复选框状态
                const checkboxes = getActiveAccountCheckboxes();
                checkboxes.forEach(cb => {
                    const id = parseInt(cb.value, 10);
                    cb.checked = selectedAccountIds.has(id);
                });

                updateBatchActionBar();
                updateSelectAllCheckbox();

                const totalSelected = selectedAccountIds.size;
                const messageKey = isGlobalAccountSearchActive()
                    ? '已选择搜索结果中所有 ${totalSelected} 个邮箱'
                    : '已选择分组内所有 ${totalSelected} 个邮箱';
                const message = translateAppTextLocal(messageKey).replace('${totalSelected}', totalSelected);
                showToast(message);
            } catch (error) {
                console.error('全选失败:', error);
                showToast(translateAppTextLocal('全选失败，请重试'), 'error');
                updateSelectAllCheckbox();
            }
        }

        // 批量检测当前分组 Outlook 是否正常：刷新 Token → 自动切到异常筛选
        async function batchDetectCurrentGroupOutlook() {
            if (currentGroupId === null || currentGroupId === undefined) {
                showToast(translateAppTextLocal('请先选择分组'), 'error');
                return;
            }

            let accountIds = [];
            try {
                // 检测应覆盖当前筛选范围（不含“仅异常”，否则漏检正常账号）
                accountIds = await fetchCurrentGroupAccountIds({ includeAnomalies: false });
            } catch (error) {
                console.error('批量检测获取账号失败:', error);
                showToast(translateAppTextLocal('获取账号列表失败'), 'error');
                return;
            }

            if (!accountIds.length) {
                showToast(translateAppTextLocal('当前分组没有可检测的账号'), 'warning');
                return;
            }

            const confirmMsg = translateAppTextLocal('将批量刷新当前范围内 ${count} 个账号的 Token，用于快速筛选异常 Outlook。是否继续？')
                .replace('${count}', String(accountIds.length));
            if (!confirm(confirmMsg)) {
                return;
            }

            if (typeof batchRefreshSelected !== 'function') {
                showToast(translateAppTextLocal('批量刷新功能不可用'), 'error');
                return;
            }

            try {
                await batchRefreshSelected(accountIds);
            } catch (error) {
                console.error('批量检测刷新失败:', error);
                showToast(translateAppTextLocal('批量检测失败'), 'error');
                return;
            }

            // 刷新完成后自动打开异常筛选，便于快速查看不正常账号
            setShowAnomaliesOnly(true, { reload: true });
            showToast(translateAppTextLocal('检测完成，已切换到异常筛选'), 'success');
        }

        // 全选当前页面所有账号
        function selectAllAccountsOnPage() {
            closeSelectAllMenus();
            const checkboxes = getActiveAccountCheckboxes();
            if (checkboxes.length === 0) {
                showToast(translateAppTextLocal('当前页暂无可选邮箱'), 'info');
                updateSelectAllCheckbox();
                return;
            }

            checkboxes.forEach(cb => {
                cb.checked = true;
                selectedAccountIds.add(parseInt(cb.value, 10));
            });
            updateBatchActionBar();
            updateSelectAllCheckbox();

            const pageSelected = checkboxes.length;
            const message = translateAppTextLocal('已选择当前页 ${pageSelected} 个邮箱').replace('${pageSelected}', pageSelected);
            showToast(message);
        }

        // 兼容旧调用名
        function selectAllAccounts() {
            selectAllAccountsOnPage();
        }

        // 取消全选（清空全部选中，含跨页）
        function unselectAllAccounts() {
            selectedAccountIds.clear();
            const checkboxes = getActiveAccountCheckboxes();
            checkboxes.forEach(cb => {
                cb.checked = false;
            });
            updateBatchActionBar();
            updateSelectAllCheckbox();
        }

        // 更新全选复选框状态（基于当前页可见项 + 全局选中集合）
        function updateSelectAllCheckbox() {
            const checkboxes = getActiveAccountCheckboxes();
            const checkedCount = checkboxes.filter(cb => cb.checked).length;
            const selectAllCheckboxes = [
                document.getElementById('selectAllCheckbox'),
                document.getElementById('compactSelectAllCheckbox')
            ].filter(Boolean);

            selectAllCheckboxes.forEach(selectAllCheckbox => {
                if (checkboxes.length === 0) {
                    selectAllCheckbox.checked = false;
                    selectAllCheckbox.indeterminate = selectedAccountIds.size > 0;
                } else if (checkedCount === 0) {
                    selectAllCheckbox.checked = false;
                    selectAllCheckbox.indeterminate = selectedAccountIds.size > 0;
                } else if (checkedCount === checkboxes.length) {
                    selectAllCheckbox.checked = true;
                    selectAllCheckbox.indeterminate = false;
                } else {
                    selectAllCheckbox.checked = false;
                    selectAllCheckbox.indeterminate = true;
                }
            });
        }

        // ==================== 验证码复制功能 ====================

        function rerenderAccountCaches() {
            const cacheKey = typeof resolveAccountListCacheKey === 'function'
                ? resolveAccountListCacheKey(currentGroupId)
                : currentGroupId;
            if (!Array.isArray(accountsCache[cacheKey])) {
                return;
            }

            renderAccountList(accountsCache[cacheKey]);
            if (typeof renderCompactAccountList === 'function') {
                renderCompactAccountList(accountsCache[cacheKey]);
            }
            if (typeof renderCompactGroupStrip === 'function') {
                renderCompactGroupStrip(groups, currentGroupId);
            }
            updateSelectAllCheckbox();
            updateBatchActionBar();
        }

        function syncAccountSummaryToAccountCache(email, accountSummary) {
            const normalizedEmail = String(email || '').trim().toLowerCase();
            if (!normalizedEmail || !accountSummary || typeof accountSummary !== 'object') {
                return false;
            }

            let updated = false;
            Object.values(accountsCache).forEach(accounts => {
                if (!Array.isArray(accounts)) {
                    return;
                }

                accounts.forEach(account => {
                    if (!account || String(account.email || '').trim().toLowerCase() !== normalizedEmail) {
                        return;
                    }

                    account.latest_email_subject = String(accountSummary.latest_email_subject || '');
                    account.latest_email_from = String(accountSummary.latest_email_from || '');
                    account.latest_email_folder = String(accountSummary.latest_email_folder || '');
                    account.latest_email_received_at = String(accountSummary.latest_email_received_at || '');
                    account.latest_verification_code = String(accountSummary.latest_verification_code || '');
                    account.latest_verification_folder = String(accountSummary.latest_verification_folder || '');
                    account.latest_verification_received_at = String(accountSummary.latest_verification_received_at || '');
                    updated = true;
                });
            });

            if (updated) {
                rerenderAccountCaches();
            }

            return updated;
        }

        function syncExtractedVerificationToAccountCache(email, verificationData, accountSummary = null) {
            if (syncAccountSummaryToAccountCache(email, accountSummary)) {
                return true;
            }

            const normalizedEmail = String(email || '').trim().toLowerCase();
            const verificationCode = String(
                verificationData?.verification_code || verificationData?.verificationCode || ''
            ).trim();

            if (!normalizedEmail || !verificationCode) {
                return false;
            }

            let updated = false;
            Object.values(accountsCache).forEach(accounts => {
                if (!Array.isArray(accounts)) {
                    return;
                }

                accounts.forEach(account => {
                    if (!account || String(account.email || '').trim().toLowerCase() !== normalizedEmail) {
                        return;
                    }

                    account.latest_verification_code = verificationCode;
                    if (verificationData?.folder) {
                        account.latest_verification_folder = String(verificationData.folder);
                    }
                    if (verificationData?.received_at) {
                        account.latest_verification_received_at = String(verificationData.received_at);
                    }
                    if (verificationData?.subject && !account.latest_email_subject) {
                        account.latest_email_subject = String(verificationData.subject);
                    }
                    updated = true;
                });
            });

            if (!updated) {
                return false;
            }
            rerenderAccountCaches();

            return true;
        }

        // 复制验证信息到剪贴板
        const verificationCopyInFlight = new Set();

        function buildVerificationExtractEndpoint(email, options = {}) {
            const normalizedSource = String(options?.source || '').trim().toLowerCase();
            const field = String(options?.field || 'any').trim().toLowerCase();
            const query = field && field !== 'any' ? `?field=${encodeURIComponent(field)}` : '';
            if (normalizedSource === 'temp' || normalizedSource === 'temp-mail' || normalizedSource === 'temp_mail') {
                return `/api/temp-emails/${encodeURIComponent(email)}/verification${query}`;
            }
            return `/api/emails/${encodeURIComponent(email)}/verification${query}`;
        }

        async function tryFallbackVerificationExtraction(options = {}) {
            if (typeof options.fallbackExtractor !== 'function') {
                return null;
            }

            try {
                const fallbackResult = await options.fallbackExtractor();
                if (!fallbackResult || !fallbackResult.formatted) {
                    return null;
                }
                return fallbackResult;
            } catch (fallbackError) {
                console.error('本地兜底提取失败:', fallbackError);
                return null;
            }
        }

        async function copyVerificationInfo(email, buttonElement, options = {}) {
            const requestKey = String(email || '').trim().toLowerCase();
            if (!requestKey || verificationCopyInFlight.has(requestKey)) {
                return false;
            }
            verificationCopyInFlight.add(requestKey);

            // 禁用按钮并显示加载状态
            const originalContent = buttonElement.innerHTML;
            buttonElement.disabled = true;
            buttonElement.innerHTML = '⏳';
            buttonElement.style.opacity = '0.6';
            buttonElement.style.cursor = 'wait';

            try {
                const response = await fetch(buildVerificationExtractEndpoint(email, options));
                const data = await response.json();

                if (data.success && data.data && data.data.formatted) {
                    await copyToClipboard(data.data.formatted);
                    syncExtractedVerificationToAccountCache(email, data.data, data.account_summary || null);
                    if (typeof window.notifyOverviewDataChanged === 'function') {
                        window.notifyOverviewDataChanged(['summary', 'verification', 'activity'], 'verification-extracted');
                    }
                    showToast(
                        getUiLanguage() === 'en'
                            ? `Copied: ${data.data.formatted}`
                            : `已复制: ${data.data.formatted}`,
                        'success'
                    );
                    // 成功状态
                    buttonElement.innerHTML = '✅';
                    buttonElement.style.opacity = '1';
                    return true;
                } else {
                    const fallbackResult = await tryFallbackVerificationExtraction(options);
                    if (fallbackResult) {
                        await copyToClipboard(
                            fallbackResult.copyText || fallbackResult.verification_code || fallbackResult.verification_link || fallbackResult.formatted
                        );
                        const copiedValue = fallbackResult.displayValue || fallbackResult.verification_code || fallbackResult.verification_link || fallbackResult.formatted;
                        showToast(
                            getUiLanguage() === 'en'
                                ? `Copied from current email: ${copiedValue}`
                                : `已从当前邮件兜底复制: ${copiedValue}`,
                            'warning'
                        );
                        buttonElement.innerHTML = '✅';
                        buttonElement.style.opacity = '1';
                        return true;
                    }

                    const errorMsg = window.resolveApiErrorMessage
                        ? window.resolveApiErrorMessage(data.error || data, '未找到验证码或链接', 'No verification code or link was found')
                        : (data.error?.message || data.error || '未找到验证码或链接');
                    showToast(errorMsg, 'error');
                    // 失败状态
                    buttonElement.innerHTML = '❌';
                    buttonElement.style.opacity = '1';
                    return false;
                }
            } catch (error) {
                console.error('提取验证码失败:', error);
                const fallbackResult = await tryFallbackVerificationExtraction(options);
                if (fallbackResult) {
                    await copyToClipboard(
                        fallbackResult.copyText || fallbackResult.verification_code || fallbackResult.verification_link || fallbackResult.formatted
                    );
                    const copiedValue = fallbackResult.displayValue || fallbackResult.verification_code || fallbackResult.verification_link || fallbackResult.formatted;
                    showToast(
                        getUiLanguage() === 'en'
                            ? `Copied from current email: ${copiedValue}`
                            : `已从当前邮件兜底复制: ${copiedValue}`,
                        'warning'
                    );
                    buttonElement.innerHTML = '✅';
                    buttonElement.style.opacity = '1';
                    return true;
                }
                showToast(translateAppTextLocal('网络错误，请重试'), 'error');
                // 失败状态
                buttonElement.innerHTML = '❌';
                buttonElement.style.opacity = '1';
                return false;
            } finally {
                verificationCopyInFlight.delete(requestKey);
                // 延迟恢复按钮状态
                setTimeout(() => {
                    buttonElement.disabled = false;
                    buttonElement.innerHTML = originalContent;
                    buttonElement.style.cursor = 'pointer';
                }, 1500);
            }
        }

        // 复制文本到剪贴板
        async function copyToClipboard(text) {
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(text);
                } else {
                    // 降级方案：使用 textarea
                    const textarea = document.createElement('textarea');
                    textarea.value = text;
                    textarea.style.position = 'fixed';
                    textarea.style.left = '-9999px';
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                }
            } catch (error) {
                console.error('复制失败:', error);
                throw error;
            }
        }

        // Fix: #accountList 在 i18n skip 列表中，MutationObserver 不会自动翻译。
        // 切换语言时必须手动重渲染账号列表，否则账号卡片文字保留旧语言（如
        // Unknown / 16 hours ago 混搭中文）。简洁模式已在 mailbox_compact.js 正确处理，
        // 此处补全标准模式。
        window.addEventListener('ui-language-changed', () => {
            const cacheKey = typeof resolveAccountListCacheKey === 'function'
                ? resolveAccountListCacheKey(currentGroupId)
                : currentGroupId;
            if (accountsCache[cacheKey]) {
                renderAccountList(accountsCache[cacheKey]);
            }
        });

