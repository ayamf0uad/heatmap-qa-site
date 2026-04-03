/**
 * Meridian site interactivity
 * FAQ accordion, mobile menu, smooth scroll, form handling
 */
(function () {
    'use strict';

    // FAQ accordion
    document.querySelectorAll('.faq-item').forEach(item => {
        item.querySelector('.faq-question')?.addEventListener('click', () => {
            // Close others
            document.querySelectorAll('.faq-item.open').forEach(other => {
                if (other !== item) other.classList.remove('open');
            });
            item.classList.toggle('open');
        });
    });

    // Mobile menu
    const menuBtn = document.querySelector('.mobile-menu-btn');
    if (menuBtn) {
        menuBtn.addEventListener('click', () => {
            const links = document.querySelector('.nav-links');
            const actions = document.querySelector('.nav-actions');
            if (links) links.style.display = links.style.display === 'flex' ? 'none' : 'flex';
            if (actions) actions.style.display = actions.style.display === 'flex' ? 'none' : 'flex';
        });
    }

    // CTA form submit simulation
    const ctaSubmit = document.getElementById('cta-submit');
    if (ctaSubmit) {
        ctaSubmit.addEventListener('click', (e) => {
            e.preventDefault();
            const email = document.getElementById('email-cta')?.value;
            if (email) {
                ctaSubmit.textContent = 'Signed up! ✓';
                ctaSubmit.style.background = '#28c840';
                setTimeout(() => {
                    ctaSubmit.textContent = 'Get started →';
                    ctaSubmit.style.background = '';
                }, 2000);
            }
        });
    }

    // Scroll-triggered fade-in
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('.feature-card, .testimonial-card, .price-card').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        observer.observe(el);
    });

    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(a => {
        a.addEventListener('click', (e) => {
            const target = document.querySelector(a.getAttribute('href'));
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });

})();
