// The afus mark (afus boutique app icon). Blue square with a white "a" on the
// dark theme; white square with a blue "a" on the light theme. Inline SVG, so
// it is sharp at any size and works offline.
export function AfusLogo({ size = 24, className = '', title }) {
    return (
        <svg viewBox="0 0 890 890" width={size} height={size} className={`afus-logo flex-none ${className}`}
            role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
            <rect className="afus-logo-bg" width="890" height="890" rx="210" />
            <path className="afus-logo-a" fillRule="evenodd" d="M270.577 657.607L324.731 598.493L325.030 598.728A195.0000 195.0000 0 0 0 599.461 564.025A195.0000 195.0000 0 0 0 563.075 289.812A195.0000 195.0000 0 0 0 460.538 250.620L460.000 250.579L460.000 170.410L460.179 170.419A275.0000 275.0000 0 0 1 639.454 250.546L640.000 251.095L640.000 170.000L720.000 170.000L720.000 720.000L640.000 720.000L640.000 638.905L639.454 639.454A275.0000 275.0000 0 0 1 270.577 657.607Z" />
            <path fill="#16B26B" fillRule="evenodd" d="M429.821 170.419L430.000 170.410L430.000 250.579L429.462 250.620A195.0000 195.0000 0 0 0 250.719 461.730A195.0000 195.0000 0 0 0 302.132 577.717L302.610 578.228L248.457 637.342L248.174 637.053A275.0000 275.0000 0 0 1 252.947 248.174A275.0000 275.0000 0 0 1 429.821 170.419Z" />
        </svg>
    );
}

export default AfusLogo;
