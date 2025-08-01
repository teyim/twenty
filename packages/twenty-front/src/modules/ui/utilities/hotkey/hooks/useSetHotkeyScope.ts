import { useRecoilCallback } from 'recoil';

import { DEBUG_HOTKEY_SCOPE } from '../constants/DebugHotkeyScope';

import { isDefined } from 'twenty-shared/utils';
import { logDebug } from '~/utils/logDebug';
import { DEFAULT_HOTKEYS_SCOPE_CUSTOM_SCOPES } from '../constants/DefaultHotkeysScopeCustomScopes';
import { currentHotkeyScopeState } from '../states/internal/currentHotkeyScopeState';
import { internalHotkeysEnabledScopesState } from '../states/internal/internalHotkeysEnabledScopesState';
import { AppHotkeyScope } from '../types/AppHotkeyScope';
import { CustomHotkeyScopes } from '../types/CustomHotkeyScope';
import { HotkeyScope } from '../types/HotkeyScope';

const areCustomScopesEqual = (
  customScopesA: CustomHotkeyScopes | undefined,
  customScopesB: CustomHotkeyScopes | undefined,
) => {
  return (
    customScopesA?.commandMenu === customScopesB?.commandMenu &&
    customScopesA?.commandMenuOpen === customScopesB?.commandMenuOpen &&
    customScopesA?.goto === customScopesB?.goto &&
    customScopesA?.keyboardShortcutMenu ===
      customScopesB?.keyboardShortcutMenu &&
    customScopesA?.searchRecords === customScopesB?.searchRecords
  );
};

export const useSetHotkeyScope = () =>
  useRecoilCallback(
    ({ snapshot, set }) =>
      async (hotkeyScopeToSet: string, customScopes?: CustomHotkeyScopes) => {
        const currentHotkeyScope = snapshot
          .getLoadable(currentHotkeyScopeState)
          .getValue();

        if (currentHotkeyScope.scope === hotkeyScopeToSet) {
          if (!isDefined(customScopes)) {
            if (
              areCustomScopesEqual(
                currentHotkeyScope?.customScopes,
                DEFAULT_HOTKEYS_SCOPE_CUSTOM_SCOPES,
              )
            ) {
              return;
            }
          } else {
            if (
              areCustomScopesEqual(
                currentHotkeyScope?.customScopes,
                customScopes,
              )
            ) {
              return;
            }
          }
        }

        const newHotkeyScope: HotkeyScope = {
          scope: hotkeyScopeToSet,
          customScopes: {
            commandMenu: customScopes?.commandMenu ?? true,
            commandMenuOpen: customScopes?.commandMenuOpen ?? true,
            goto: customScopes?.goto ?? false,
            keyboardShortcutMenu: customScopes?.keyboardShortcutMenu ?? false,
            searchRecords: customScopes?.searchRecords ?? false,
          },
        };

        const scopesToSet: string[] = [];

        if (newHotkeyScope.customScopes?.commandMenu === true) {
          scopesToSet.push(AppHotkeyScope.CommandMenu);
        }

        if (newHotkeyScope.customScopes?.commandMenuOpen === true) {
          scopesToSet.push(AppHotkeyScope.CommandMenuOpen);
        }

        if (newHotkeyScope?.customScopes?.goto === true) {
          scopesToSet.push(AppHotkeyScope.Goto);
        }

        if (newHotkeyScope?.customScopes?.keyboardShortcutMenu === true) {
          scopesToSet.push(AppHotkeyScope.KeyboardShortcutMenu);
        }

        if (newHotkeyScope?.customScopes?.searchRecords === true) {
          scopesToSet.push(AppHotkeyScope.SearchRecords);
        }

        scopesToSet.push(newHotkeyScope.scope);

        if (DEBUG_HOTKEY_SCOPE) {
          logDebug(`DEBUG: set new hotkey scope : ${newHotkeyScope.scope}`, {
            scopesToSet,
            newHotkeyScope,
          });
        }

        set(internalHotkeysEnabledScopesState, scopesToSet);
        set(currentHotkeyScopeState, newHotkeyScope);
      },
    [],
  );
