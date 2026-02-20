/**
 * Movies - OMDb API integration and home page logic
 * Search movies, display results, show modal with details
 */

const OMDB_API_KEY = '90e4ede5';
const OMDB_BASE = 'https://www.omdbapi.com/';

// DOM elements
const searchInput = document.getElementById('searchInput');
const searchSection = document.getElementById('searchSection');
const searchResults = document.getElementById('searchResults');
const loadingSection = document.getElementById('loadingSection');
const popularSection = document.getElementById('popularSection');
const popularMovies = document.getElementById('popularMovies');
const movieModal = document.getElementById('movieModal');
const modalClose = document.getElementById('modalClose');

// Debounce for search
let searchTimeout = null;

/**
 * Fetch movies from OMDb API (search)
 */
async function searchMovies(query) {
  if (!query || query.length < 2) return null;
  try {
    const url = `${OMDB_BASE}?s=${encodeURIComponent(query)}&apikey=${OMDB_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.Response === 'True' && data.Search) {
      return data.Search;
    }
    return [];
  } catch (err) {
    console.error('Search error:', err);
    return [];
  }
}

/**
 * Fetch single movie details from OMDb API
 */
async function getMovieDetails(title) {
  try {
    const url = `${OMDB_BASE}?t=${encodeURIComponent(title)}&apikey=${OMDB_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.Response === 'True') {
      return data;
    }
    return null;
  } catch (err) {
    console.error('Details error:', err);
    return null;
  }
}

/**
 * Create poster card HTML
 */
function createPosterCard(movie) {
  const poster = movie.Poster && movie.Poster !== 'N/A' 
    ? movie.Poster 
    : null;
  const title = movie.Title || 'Unknown';
  const year = movie.Year || 'N/A';

  const div = document.createElement('div');
  div.className = 'movie-poster';
  div.dataset.title = title;
  div.innerHTML = `
    ${poster 
      ? `<img src="${poster}" alt="${title}" loading="lazy">` 
      : `<div class="poster-placeholder">No Poster</div>`}
    <div class="movie-info">
      <div class="movie-title">${title}</div>
      <div class="movie-year">${year}</div>
    </div>
  `;
  div.addEventListener('click', () => openMovieModal(title));
  return div;
}

/**
 * Render movie list into container
 */
function renderMovies(container, movies) {
  container.innerHTML = '';
  if (!movies || movies.length === 0) {
    container.innerHTML = '<p style="color: var(--netflix-gray); padding: 1rem;">No movies found.</p>';
    return;
  }
  movies.forEach(movie => {
    container.appendChild(createPosterCard(movie));
  });
}

/**
 * Show loading state
 */
function setLoading(show) {
  loadingSection.style.display = show ? 'block' : 'none';
}

/**
 * Open modal with movie details
 */
async function openMovieModal(title) {
  setLoading(true);
  const movie = await getMovieDetails(title);
  setLoading(false);

  if (!movie) {
    alert('Could not load movie details.');
    return;
  }

  document.getElementById('modalPoster').src = movie.Poster && movie.Poster !== 'N/A' ? movie.Poster : '';
  document.getElementById('modalPoster').alt = movie.Title;
  document.getElementById('modalTitle').textContent = movie.Title;
  document.getElementById('modalMeta').textContent = `${movie.Year} • ${movie.Runtime || 'N/A'}`;
  document.getElementById('modalPlot').textContent = movie.Plot || 'No plot available.';
  document.getElementById('modalActors').textContent = movie.Actors || 'N/A';
  document.getElementById('modalGenre').textContent = movie.Genre || 'N/A';
  document.getElementById('modalRating').textContent = movie.imdbRating || 'N/A';

  movieModal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

/**
 * Close modal
 */
function closeModal() {
  movieModal.classList.remove('active');
  document.body.style.overflow = '';
}

// Event: Search input (debounced)
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const query = searchInput.value.trim();
  
  if (query.length < 2) {
    searchSection.style.display = 'none';
    popularSection.style.display = 'block';
    return;
  }

  searchTimeout = setTimeout(async () => {
    setLoading(true);
    searchSection.style.display = 'block';
    popularSection.style.display = 'none';
    
    const movies = await searchMovies(query);
    renderMovies(searchResults, movies);
    setLoading(false);
  }, 350);
});

// Event: Modal close
modalClose.addEventListener('click', closeModal);
movieModal.addEventListener('click', (e) => {
  if (e.target === movieModal) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// Event: Logout
document.getElementById('logoutBtn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/logout', {
      method: 'POST',
      credentials: 'include',
    });
    const data = await res.json();
    if (data.success) {
      window.location.href = data.redirect || '/login.html';
    }
  } catch (err) {
    window.location.href = '/login.html';
  }
});

// Navbar scroll effect
window.addEventListener('scroll', () => {
  const navbar = document.getElementById('navbar');
  if (window.scrollY > 50) {
    navbar.classList.add('scrolled');
  } else {
    navbar.classList.remove('scrolled');
  }
});

// Load popular movies on page load
(async function init() {
  // Check session - redirect if not logged in
  const sessionRes = await fetch('/api/session', { credentials: 'include' });
  const session = await sessionRes.json();
  if (!session.loggedIn) {
    window.location.href = '/login.html';
    return;
  }

  // Load default popular movies
  setLoading(true);
  const popular = await searchMovies('action');
  renderMovies(popularMovies, popular || []);
  setLoading(false);
})();
