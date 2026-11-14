/**
 * Every storefront selector the suite uses, in one place.
 *
 * All of these are Luma's. Keeping them here is what makes a Hyva variant of
 * this suite a copy of this file with a different map, rather than a rewrite
 * of the specs -- and it means a spec that creates a product in the admin and
 * one that buys a fixture product agree on what a product page looks like.
 */
export const luma = {
    navCategory: '.navigation li.level0 > a',
    productItem: '.product-item-info',
    productItemLink: 'a.product-item-link',
    pageTitle: '.page-title',
    productPrice: '.product-info-main .price',
    addToCart: '#product-addtocart-button',
    swatchGroup: '.swatch-attribute',
    swatchOption: '.swatch-option:not(.disabled)',
    optionSelect: 'select.super-attribute-select',
    cartSuccess: '.message-success',
    minicartCounter: '.minicart-wrapper .counter-number',
    cartItemName: '.cart.item .product-item-name',
    proceedToCheckout: 'button[data-role="proceed-to-checkout"]',
    checkoutEmail: '#customer-email',
    shippingForm: '#co-shipping-form',
    shippingMethod: 'input[value="flatrate_flatrate"]',
    nextButton: 'button[data-role="opc-continue"]',
    paymentSection: '#checkout-step-payment',
    placeOrder: '#checkout-payment-method-load button.action.checkout.primary',
    successPageTitle: '.page-title',
    successBlock: '.checkout-success',
};

/**
 * Magento appends catalog/seo/product_url_suffix to a product's url key. The
 * default is .html and this gate never changes it, so a spec that navigates
 * straight to a product it just created can build the path itself instead of
 * hunting for a link to it.
 */
export const productUrlSuffix = process.env.MAGENTO_PRODUCT_URL_SUFFIX ?? '.html';

/** The storefront path for a product url key, e.g. storefrontUrl('a-product'). */
export function productUrl(urlKey: string): string {
    return `/${urlKey}${productUrlSuffix}`;
}
