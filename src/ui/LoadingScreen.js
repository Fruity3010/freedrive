export class LoadingScreen {
    constructor() {
        this.container = null;
        this.progressBar = null;
        this.progressText = null;
        this.createLoadingScreen();
    }

    createLoadingScreen() {
        this.container = document.createElement('div');
        this.container.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: #000;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 9999;
            font-family: Arial, sans-serif;
            color: #fff;
        `;

        const title = document.createElement('h1');
        title.textContent = 'LOADING...';
        title.style.cssText = `
            font-size: 48px;
            margin-bottom: 40px;
            color: #fff;
        `;

        const progressContainer = document.createElement('div');
        progressContainer.style.cssText = `
            width: 400px;
            max-width: 80%;
            height: 30px;
            background: #333;
            border-radius: 15px;
            overflow: hidden;
        `;

        this.progressBar = document.createElement('div');
        this.progressBar.style.cssText = `
            width: 0%;
            height: 100%;
            background: #4CAF50;
            transition: width 0.3s ease;
        `;

        progressContainer.appendChild(this.progressBar);

        this.progressText = document.createElement('p');
        this.progressText.textContent = '0%';
        this.progressText.style.cssText = `
            margin-top: 15px;
            font-size: 20px;
            color: #fff;
        `;

        this.container.appendChild(title);
        this.container.appendChild(progressContainer);
        this.container.appendChild(this.progressText);
        document.body.appendChild(this.container);
    }

    updateProgress(progress) {
        const percentage = Math.round(progress * 100);
        if (this.progressBar) {
            this.progressBar.style.width = `${percentage}%`;
        }
        if (this.progressText) {
            this.progressText.textContent = `${percentage}%`;
        }
    }

    hide() {
        if (this.container) {
            this.container.style.transition = 'opacity 0.5s ease';
            this.container.style.opacity = '0';
            setTimeout(() => {
                if (this.container && this.container.parentNode) {
                    this.container.parentNode.removeChild(this.container);
                }
            }, 500);
        }
    }
}
