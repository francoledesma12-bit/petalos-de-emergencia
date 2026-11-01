// El widget de ElevenLabs va suelto en la página: dentro de un <dialog> modal queda inerte y no se ve.
document.querySelectorAll('[data-flora-voice]').forEach(button => button.addEventListener('click', () => {
  document.body.classList.add('flora-voz-activa');
  if (document.querySelector('elevenlabs-convai')) return;
  const widget = document.createElement('elevenlabs-convai');
  widget.setAttribute('agent-id', 'agent_7401m6cbkhs6ffktsnvptprzb61m');
  widget.setAttribute('variant', 'expanded');
  document.body.append(widget);
  const script = document.createElement('script');
  script.src = 'https://unpkg.com/@elevenlabs/convai-widget-embed';
  script.async = true;
  script.onerror = () => { widget.remove(); script.remove(); document.body.classList.remove('flora-voz-activa'); alert('No se pudo cargar la voz. Probá de nuevo en unos segundos.'); };
  document.body.append(script);
}));
// La barra flotante solo aparece cuando el chat de la portada no está a la vista.
const dock = document.querySelector('.flora-dock');
const chatPortada = document.querySelector('#consulta');
if (dock && chatPortada && 'IntersectionObserver' in window) {
  new IntersectionObserver(([e]) => dock.classList.toggle('oculto', e.isIntersecting), { threshold: 0.25 }).observe(chatPortada);
}
