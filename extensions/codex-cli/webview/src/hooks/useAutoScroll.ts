/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect } from 'react';

export function useAutoScroll(ref: React.RefObject<HTMLElement>, deps: unknown[]): void {
	useEffect(() => {
		const el = ref.current;
		if (!el) { return; }
		el.scrollTop = el.scrollHeight;
	}, deps);
}
