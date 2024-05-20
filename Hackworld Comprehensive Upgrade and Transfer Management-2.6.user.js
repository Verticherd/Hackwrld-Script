// ==UserScript==
// @name         Hackworld Comprehensive Upgrade and Transfer Management
// @namespace    http://tampermonkey.net/
// @version      2.6
// @description  Comprehensive management of upgrades and transfers in Hackworld, with persistent state, enhanced error handling, and inactivity detection. Stealing mode ensures a buffer equal to the cost of one scanner upgrade plus one stealer upgrade.
// @include      https://hackwrld.notacult.website/cc/158129/home*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Constants for time intervals
    const CHECK_INTERVAL = 500;
    const UPGRADE_DELAY = 1500;
    const INACTIVITY_THRESHOLD = 60000; // 1 minute for example

    // Log levels
    const LOG_LEVEL = {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3
    };

    let currentLogLevel = LOG_LEVEL.WARN; // Default log level

    function log(message, level = LOG_LEVEL.INFO) {
        if (level >= currentLogLevel) {
            console.log(message);
        }
    }

    function setLogLevel(level) {
        currentLogLevel = level;
    }

    // Flags to prevent simultaneous upgrades and transfers
    let transferInProgress = false;
    let currentlyUpgrading = false;

    // Control flags for different modes
    let upgradeTargetControlActive = false;
    let stealingModeActive = false;

    // Transfer threshold multiplier
    let transferThresholdMultiplier = 0.25;

    // Upgrade target levels for different components
    let upgradeTargets = {
        fw: 0,
        sc: 0,
        mi: 0,
        st: 0,
        va: 0
    };

    // Most recent victim of a steal
    let mostRecentVictim = "";

    // Flag to check if panel is minimized
    let panelMinimized = false;

    // Last coins value and timestamp
    let lastCoins = null;
    let lastVault = null;
    let lastActivityTimestamp = Date.now();

    /**
     * Extract numeric value from a string in the format "(2.1)".
     * @param {string} text - The text containing the numeric value.
     * @returns {number} - The extracted numeric value.
     */
    function getNumericValueFromString(text) {
        let matches = text.match(/\(([\d\.]+)\)/);
        return matches ? parseFloat(matches[1]) : NaN;
    }

    /**
     * Create the control panel for managing upgrade targets and modes.
     */
    function createUpgradeTargetControlPanel() {
        const styleHTML = `
            <style>
                #upgradeTargetControlPanel {
                    position: fixed;
                    bottom: 10px;
                    left: 10px;
                    background: #333;
                    color: #fff;
                    padding: 10px;
                    border-radius: 5px;
                    width: 300px;
                    z-index: 1000;
                }
                #minimizedPanel {
                    position: fixed;
                    bottom: 10px;
                    left: 10px;
                    background: #333;
                    color: #fff;
                    padding: 10px;
                    border-radius: 5px;
                    display: none;
                    cursor: pointer;
                    z-index: 1000;
                }
                #upgradeTargetControlPanel h4 {
                    margin: 0 0 10px;
                }
                #upgradeTargetControlPanel label {
                    display: block;
                    margin-bottom: 5px;
                }
                #upgradeTargetControlPanel input[type="number"] {
                    width: 50px;
                }
                .notification {
                    position: fixed;
                    bottom: 50px;
                    left: 10px;
                    background: #444;
                    color: #fff;
                    padding: 10px;
                    border-radius: 5px;
                    z-index: 1000;
                }
                .notification.success {
                    background: green;
                }
                .notification.error {
                    background: red;
                }
            </style>
        `;

        const panelHTML = `
            <div id="upgradeTargetControlPanel">
                <h4>Upgrade Target Control
                    <button id="minimizeButton" style="float: right; background: transparent; border: none; color: #fff; font-size: 18px; cursor: pointer;">&#8211;</button>
                </h4>
                <label>
                    <input type="checkbox" id="toggleUpgradeTargetControl"> Activate Upgrade Target Control
                </label>
                <div>
                    <label>Firewall Target Level: <input type="number" id="fwTarget" min="0"></label>
                    <div>Current Level: <span id="fwCurrent"></span></div>
                </div>
                <div>
                    <label>Scanner Target Level: <input type="number" id="scTarget" min="0"></label>
                    <div>Current Level: <span id="scCurrent"></span></div>
                </div>
                <div>
                    <label>Miner Target Level: <input type="number" id="miTarget" min="0"></label>
                    <div>Current Level: <span id="miCurrent"></span></div>
                </div>
                <div>
                    <label>Stealer Target Level: <input type="number" id="stTarget" min="0"></label>
                    <div>Current Level: <span id="stCurrent"></span></div>
                </div>
                <div>
                    <label>Vault Target Level: <input type="number" id="vaTarget" min="0"></label>
                    <div>Current Level: <span id="vaCurrent"></span></div>
                </div>
                <div>
                    <label>Transfer Threshold Multiplier: <input type="number" id="transferThresholdMultiplier" min="0" step="0.01" value="${transferThresholdMultiplier}"></label>
                </div>
                <div>
                    <label>
                        <input type="checkbox" id="toggleStealingMode"> Activate Stealing Mode
                    </label>
                </div>
                <div>
                    <h4>Most Recent Victim</h4>
                    <div id="mostRecentVictim" style="padding: 5px; background-color: #444; border-radius: 5px;">None</div>
                </div>
            </div>
            <div id="minimizedPanel">
                <span style="font-size: 18px;">&#9881;</span>
            </div>
        `;

        $('body').append(styleHTML);
        $('body').append(panelHTML);

        // Load saved state
        loadState();

        // Event listeners for control panel elements
        $('#toggleUpgradeTargetControl').change(function() {
            upgradeTargetControlActive = this.checked;
            saveState();
            if (upgradeTargetControlActive) {
                performUpgradeTargetControl();
            }
        });

        $('#toggleStealingMode').change(function() {
            stealingModeActive = this.checked;
            saveState();
        });

        $('#fwTarget, #scTarget, #miTarget, #stTarget, #vaTarget').change(function() {
            const targetId = this.id.replace('Target', '');
            upgradeTargets[targetId] = parseInt(this.value, 10);
            saveState();
        });

        $('#transferThresholdMultiplier').change(function() {
            transferThresholdMultiplier = parseFloat(this.value);
            saveState();
        });

        // Event listener for minimize button
        $('#minimizeButton').click(function() {
            $('#upgradeTargetControlPanel').hide();
            $('#minimizedPanel').show();
            panelMinimized = true;
            saveState();
        });

        // Event listener for minimized panel
        $('#minimizedPanel').click(function() {
            $('#minimizedPanel').hide();
            $('#upgradeTargetControlPanel').show();
            panelMinimized = false;
            saveState();
        });
    }

    /**
     * Update the most recent victim displayed in the control panel.
     * @param {string} victim - The name of the most recent victim.
     */
    function updateMostRecentVictim(victim) {
        mostRecentVictim = victim;
        $('#mostRecentVictim').text(victim);
        log(`[Victim Update] Most recent victim updated to ${victim}`, LOG_LEVEL.INFO);
    }

    /**
     * Monitor the event log for successful steals and update the most recent victim.
     */
    function monitorEventLog() {
        const eventLogContainer = $('.inner');
        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                if (mutation.addedNodes) {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'P') {
                            const text = node.textContent;
                            const match = text.match(/BROADCAST \| (\w+) lost [\d.]+ coins to DalibanSuperSoldier/);
                            if (match) {
                                const victim = match[1];
                                updateMostRecentVictim(victim);
                            }
                        }
                    });
                }
            });
        });

        observer.observe(eventLogContainer[0], { childList: true, subtree: true });
    }

    /**
     * Upgrade a component to its target level if conditions are met.
     * @param {string} componentId - The ID of the component to upgrade.
     * @param {number} currentLevel - The current level of the component.
     * @param {number} targetLevel - The target level of the component.
     * @param {number} cost - The cost of upgrading the component.
     */
    function upgradeComponentToTarget(componentId, currentLevel, targetLevel, cost) {
        if (currentLevel < targetLevel) {
            log(`[Upgrade Check] Component: ${componentId}, Current Level: ${currentLevel}, Target Level: ${targetLevel}, Cost: ${cost}, Vault: ${parseFloat($('#vault').text())}`, LOG_LEVEL.DEBUG);
            upgradeComponentIfNeeded(componentId, cost, parseFloat($('#vault').text()) >= cost);
        }
    }

    /**
     * Perform upgrades based on the target levels set in the control panel.
     */
    function performUpgradeTargetControl() {
        if (!upgradeTargetControlActive || currentlyUpgrading) return;

        let currentLevels = getCurrentLevels();
        let costs = getUpgradeCosts();

        let discrepancies = getDiscrepancies(currentLevels, costs);

        discrepancies.sort((a, b) => b.discrepancy - a.discrepancy);

        if (discrepancies.length > 0) {
            let componentToUpgrade = discrepancies[0];
            let componentId = getComponentId(componentToUpgrade.id);
            log(`[Priority Upgrade] Component: ${componentId}, Discrepancy: ${componentToUpgrade.discrepancy}`, LOG_LEVEL.INFO);
            upgradeComponentToTarget(componentId, currentLevels[componentToUpgrade.id], upgradeTargets[componentToUpgrade.id], componentToUpgrade.cost);
        }

        updateCurrentLevelDisplay(currentLevels);

        // Schedule the next check
        setTimeout(performUpgradeTargetControl, CHECK_INTERVAL);
    }

    /**
     * Upgrade a component if the upgrade condition is met.
     * @param {string} componentId - The ID of the component to upgrade.
     * @param {number} cost - The cost of upgrading the component.
     * @param {boolean} conditionToUpgrade - Whether the upgrade condition is met.
     */
    function upgradeComponentIfNeeded(componentId, cost, conditionToUpgrade) {
        if (currentlyUpgrading) {
            log(`[Upgrade Skipped] Upgrade already in progress for ${componentId}.`, LOG_LEVEL.DEBUG);
            return;
        }

        let buffer = 0;

        if (stealingModeActive) {
            let scannerCost = getNumericValueFromString($('#sccost').text());
            let stealerCost = getNumericValueFromString($('#stcost').text());
            buffer = scannerCost + stealerCost;
        }

        let upgradeButtonId = componentId.replace('max', '');
        let vaultAmount = parseFloat($('#vault').text());

        if (conditionToUpgrade && (vaultAmount - cost >= buffer)) {
            currentlyUpgrading = true;
            log(`[Upgrade Initiated] Attempting to upgrade ${componentId} with cost ${cost}.`, LOG_LEVEL.INFO);

            if (stealingModeActive && componentId !== 'vaultupgrade') {
                let numUpgrades = Math.floor((vaultAmount - buffer) / cost);
                log(`[Stealing Mode] Performing ${numUpgrades} upgrades for ${upgradeButtonId}`, LOG_LEVEL.INFO);
                performMultipleUpgrades(upgradeButtonId, numUpgrades, UPGRADE_DELAY);
            } else {
                performSingleUpgrade(componentId);
            }
        } else if (componentId === 'vaultupgrade' && vaultAmount >= cost) {
            currentlyUpgrading = true;
            log(`[Vault Upgrade Initiated] Attempting to upgrade vault with cost ${cost}.`, LOG_LEVEL.INFO);
            performSingleUpgrade(componentId);
        } else {
            log(`[Upgrade Condition Not Met] Not enough resources to upgrade ${componentId}.`, LOG_LEVEL.DEBUG);
        }
    }

    /**
     * Perform single upgrade.
     * @param {string} componentId - The ID of the component to upgrade.
     */
    function performSingleUpgrade(componentId) {
        let button = document.getElementById(componentId);
        if (button) {
            button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            log(`[Upgrade Click] Clicked upgrade button for ${componentId}`, LOG_LEVEL.DEBUG);
            setTimeout(() => {
                currentlyUpgrading = false;
                log(`[Upgrade Completed] Upgrade process for ${componentId} completed.`, LOG_LEVEL.INFO);
            }, UPGRADE_DELAY); // Adjusted to 1.5 seconds to ensure completion
        } else {
            log(`[Upgrade Error] Upgrade button for ${componentId} not found`, LOG_LEVEL.ERROR);
            currentlyUpgrading = false;
        }
    }

    /**
     * Perform multiple upgrades with a delay between each upgrade.
     * @param {string} componentId - The ID of the component to upgrade.
     * @param {number} numUpgrades - The number of upgrades to perform.
     * @param {number} delay - The delay between each upgrade.
     */
    function performMultipleUpgrades(componentId, numUpgrades, delay) {
        let upgradeCount = 0;

        function upgrade() {
            if (upgradeCount < numUpgrades) {
                let button = document.getElementById(componentId);
                if (button) {
                    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    log(`[Upgrade Click] Clicked upgrade button for ${componentId}`, LOG_LEVEL.DEBUG);
                    upgradeCount++;
                    setTimeout(upgrade, delay);
                } else {
                    log(`[Upgrade Error] Upgrade button for ${componentId} not found`, LOG_LEVEL.ERROR);
                    currentlyUpgrading = false;
                }
            } else {
                currentlyUpgrading = false;
                log(`[Upgrade Completed] Completed ${numUpgrades} upgrades for ${componentId}.`, LOG_LEVEL.INFO);
            }
        }

        upgrade();
    }

    /**
     * Perform coin transfers to the vault based on the transfer threshold.
     */
    function performTransfers() {
        if (transferInProgress) {
            log("[Transfer Skipped] Transfer already in progress.", LOG_LEVEL.DEBUG);
            return;
        }

        var coins = parseFloat($('#funds').text());
        var minerCost = getNumericValueFromString($('#micost').text());
        var transferThreshold = minerCost * transferThresholdMultiplier; // Adjustable transfer threshold

        let buffer = 0;

        if (stealingModeActive) {
            let scannerCost = getNumericValueFromString($('#sccost').text());
            let stealerCost = getNumericValueFromString($('#stcost').text());
            buffer = scannerCost + stealerCost;
        }

        log(`[Resource Status] Coins: ${coins}, Miner Cost: ${minerCost}, Transfer Threshold: ${transferThreshold}, Buffer: ${buffer}`, LOG_LEVEL.DEBUG);

        // Transfer logic based on threshold
        if (coins >= transferThreshold && (parseFloat($('#vault').text()) + coins) >= buffer) {
            transferInProgress = true; // Set the flag before starting the transfer
            log('[Transfer Initiated] Transferring coins to vault due to threshold strategy...', LOG_LEVEL.INFO);
            $('#storevault').click();
            setTimeout(() => {
                transferInProgress = false; // Clear the flag after the transfer completes
                log('[Transfer Completed] Transfer process completed.', LOG_LEVEL.INFO);
            }, CHECK_INTERVAL); // Half the interval time to avoid rapid repeat before state check
        } else {
            log('[Transfer Condition Not Met] Not enough coins to transfer to vault.', LOG_LEVEL.DEBUG);
        }
    }

    /**
     * Perform strategic upgrades and transfers based on the active mode.
     */
    function performStrategicUpgradesAndTransfers() {
        if (upgradeTargetControlActive) {
            performUpgradeTargetControl();
        } else {
            // Perform standard upgrades
            let currentLevels = getCurrentLevels();
            let costs = getUpgradeCosts();

            let vault = parseFloat($('#vault').text());
            let minerCost = costs.mi;
            let vaultCost = costs.va;
            let scannerCost = costs.sc;
            let stealerCost = costs.st;

            let buffer = 0;

            if (stealingModeActive) {
                buffer = scannerCost + stealerCost;
            }

            log(`[Resource Status] Vault: ${vault}, Miner Cost: ${minerCost}, Buffer: ${buffer}`, LOG_LEVEL.DEBUG);

            upgradeComponentIfNeeded('minerupgrademax', minerCost, vault >= minerCost + buffer);
            upgradeComponentIfNeeded('vaultupgrade', vaultCost, vault >= vaultCost + buffer && minerCost > vault * 10);

            // Conditional upgrades for scanner and stealer
            let transferThreshold = minerCost * transferThresholdMultiplier; // Adjustable transfer threshold
            if (scannerCost <= transferThreshold) {
                upgradeComponentIfNeeded('scannerupgrademax', scannerCost, vault >= scannerCost + buffer);
            }
            if (stealerCost <= transferThreshold) {
                upgradeComponentIfNeeded('stealerupgrademax', stealerCost, vault >= stealerCost + buffer);
            }
        }
        performTransfers(); // Always attempt transfers after any upgrade attempts

        // Check for inactivity and force refresh if needed
        checkForInactivity();
    }

    /**
     * Initialize the automation script.
     */
    function initAutomation() {
        log('[Script Initiated] Comprehensive upgrade and transfer management script started.', LOG_LEVEL.INFO);
        createUpgradeTargetControlPanel();
        monitorEventLog();

        setInterval(performStrategicUpgradesAndTransfers, CHECK_INTERVAL); // Perform checks every 0.5 seconds
    }

    /**
     * Wait for jQuery to be loaded before initializing the automation script.
     */
    function waitForJQuery() {
        if (typeof $ == 'undefined') {
            window.setTimeout(waitForJQuery, 100);
        } else {
            initAutomation();
        }
    }

    /**
     * Get the current levels of the components.
     * @param {Array} components - The list of components to get the levels for.
     * @returns {Object} - The current levels of the components.
     */
    function getCurrentLevels(components = ['fw', 'sc', 'mi', 'st', 'va']) {
        let levels = {};
        components.forEach(component => {
            levels[component] = parseFloat($(`#${component}`).text());
        });
        return levels;
    }

    /**
     * Get the upgrade costs of the components.
     * @param {Array} components - The list of components to get the costs for.
     * @returns {Object} - The upgrade costs of the components.
     */
    function getUpgradeCosts(components = ['fw', 'sc', 'mi', 'st', 'va']) {
        let costs = {};
        components.forEach(component => {
            costs[component] = getNumericValueFromString($(`#${component}cost`).text());
        });
        return costs;
    }

    /**
     * Get the discrepancies between the target levels and the current levels.
     * @param {Object} currentLevels - The current levels of the components.
     * @param {Object} costs - The upgrade costs of the components.
     * @returns {Array} - The discrepancies between the target levels and the current levels.
     */
    function getDiscrepancies(currentLevels, costs) {
        let discrepancies = [];
        for (let key in currentLevels) {
            let discrepancy = upgradeTargets[key] - currentLevels[key];
            if (discrepancy > 0) {
                discrepancies.push({ id: key, discrepancy: discrepancy, cost: costs[key] });
            }
        }
        return discrepancies;
    }

    /**
     * Get the component ID for the given key.
     * @param {string} key - The key of the component.
     * @returns {string} - The component ID.
     */
    function getComponentId(key) {
        switch (key) {
            case 'fw':
                return 'fwupgrademax';
            case 'sc':
                return 'scannerupgrademax';
            case 'mi':
                return 'minerupgrademax';
            case 'st':
                return 'stealerupgrademax';
            case 'va':
                return 'vaultupgrade'; // Fixed for single upgrades
            default:
                return '';
        }
    }

    /**
     * Update the current level display in the control panel.
     * @param {Object} currentLevels - The current levels of the components.
     */
    function updateCurrentLevelDisplay(currentLevels) {
        $('#fwCurrent').text(`${currentLevels.fw}`);
        $('#scCurrent').text(`${currentLevels.sc}`);
        $('#miCurrent').text(`${currentLevels.mi}`);
        $('#stCurrent').text(`${currentLevels.st}`);
        $('#vaCurrent').text(`${currentLevels.va}`);
    }

    /**
     * Save the current state of the UI to localStorage.
     */
    function saveState() {
        localStorage.setItem('upgradeTargetControlActive', upgradeTargetControlActive);
        localStorage.setItem('stealingModeActive', stealingModeActive);
        localStorage.setItem('transferThresholdMultiplier', transferThresholdMultiplier);
        localStorage.setItem('upgradeTargets', JSON.stringify(upgradeTargets));
        localStorage.setItem('panelMinimized', panelMinimized);
    }

    /**
     * Load the saved state of the UI from localStorage.
     */
    function loadState() {
        upgradeTargetControlActive = localStorage.getItem('upgradeTargetControlActive') === 'true';
        stealingModeActive = localStorage.getItem('stealingModeActive') === 'true';
        transferThresholdMultiplier = parseFloat(localStorage.getItem('transferThresholdMultiplier')) || transferThresholdMultiplier;
        upgradeTargets = JSON.parse(localStorage.getItem('upgradeTargets')) || upgradeTargets;
        panelMinimized = localStorage.getItem('panelMinimized') === 'true';

        $('#toggleUpgradeTargetControl').prop('checked', upgradeTargetControlActive);
        $('#toggleStealingMode').prop('checked', stealingModeActive);
        $('#transferThresholdMultiplier').val(transferThresholdMultiplier);
        $('#fwTarget').val(upgradeTargets.fw);
        $('#scTarget').val(upgradeTargets.sc);
        $('#miTarget').val(upgradeTargets.mi);
        $('#stTarget').val(upgradeTargets.st);
        $('#vaTarget').val(upgradeTargets.va);

        if (panelMinimized) {
            $('#upgradeTargetControlPanel').hide();
            $('#minimizedPanel').show();
        }
    }

    /**
     * Check for inactivity and force refresh if no change in coins for an extended period.
     */
    function checkForInactivity() {
        const currentCoins = parseFloat($('#funds').text());
        const currentVault = parseFloat($('#vault').text());
        const currentTime = Date.now();

        if (lastCoins !== null && currentCoins === lastCoins && currentVault === lastVault) {
            if (currentTime - lastActivityTimestamp > INACTIVITY_THRESHOLD) {
                log('[Inactivity Detected] Refreshing the page due to inactivity.', LOG_LEVEL.WARN);
                location.reload();
            }
        } else {
            lastCoins = currentCoins;
            lastVault = currentVault;
            lastActivityTimestamp = currentTime;
        }
    }

    waitForJQuery();
})();
