import Fuse from 'fuse.js';

type SearchItem = {
	name: string;
	description?: string | null;
	summary?: string | null;
	authors?: string | null;
	url: string;
};

let fuse: Fuse<SearchItem> | null = null;
let fuseReady: Promise<void> | null = null;

const ensureFuse = async () => {
	if (!fuseReady) {
		fuseReady = fetch('/search-index.json')
			.then((response) => response.json())
			.then((data: SearchItem[]) => {
				fuse = new Fuse(data, {
					keys: ['name', 'description', 'summary', 'authors'],
					threshold: 0.4,
					ignoreLocation: true,
				});
			})
			.catch((error) => {
				console.error('Failed to load search index', error);
				fuse = null;
			});
	}

	return fuseReady;
};

const hideSearchResults = (element: HTMLElement) => {
	element.classList.add('opacity-0', 'invisible');
};

const showSearchResults = (element: HTMLElement) => {
	element.classList.remove('opacity-0', 'invisible');
};

const setupSearch = () => {
	const searchInput = document.getElementById('search-input');
	const searchResults = document.getElementById('search-results');

	if (!(searchInput instanceof HTMLInputElement) || !(searchResults instanceof HTMLElement)) {
		return;
	}

	ensureFuse();

	const renderResults = (results: Fuse.FuseResult<SearchItem>[], query: string) => {
		if (!results.length) {
			searchResults.innerHTML = `
				<div class="p-4 text-center text-sm text-gray-500 dark:text-slate-500">
					No modules found matching "${query}"
				</div>
			`;
			showSearchResults(searchResults);
			return;
		}

		searchResults.innerHTML = results
			.map(
				(result) => `
				<a href="${result.item.url}" class="block p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors group">
					<div class="font-medium text-gray-900 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">${result.item.name}</div>
					<div class="text-xs text-gray-500 dark:text-slate-500 line-clamp-1 mt-0.5">${result.item.description || result.item.summary || ''}</div>
				</a>
			`,
			)
			.join('');

		showSearchResults(searchResults);
	};

	searchInput.addEventListener('input', async (event) => {
		const target = event.target;
		if (!(target instanceof HTMLInputElement)) {
			return;
		}

		const query = target.value.trim();
		if (!query) {
			hideSearchResults(searchResults);
			return;
		}

		await ensureFuse();

		if (!fuse) {
			hideSearchResults(searchResults);
			return;
		}

		const results = fuse.search(query).slice(0, 5);
		renderResults(results, query);
	});

	document.addEventListener('click', (event) => {
		const target = event.target;
		if (!(target instanceof Node)) {
			return;
		}

		if (!searchInput.contains(target) && !searchResults.contains(target)) {
			hideSearchResults(searchResults);
		}
	});
};

// Initialize search
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', setupSearch);
} else {
	setupSearch();
}
