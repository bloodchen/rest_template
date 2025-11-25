export const Config = {
    project: {
        name: process.env.APP_NAME || "rest_template"
    },
    modules: process.env.modules,
    plans: {
        plan_plus: {
            co: 'mx',
            name: "Plus Plan Monthly",
            mode: "sub",
            trial_day: 3,
            coupon: 'lnT0v68q',
            coupon_test1: 'ZGvvUs6p',
            price: "990|M", //usd cents
        },
        plan_plus_year: {
            co: 'mx',
            name: "Plus Plan Yearly",
            mode: "sub",
            trial_day: 3,
            coupon: 'lnT0v68q',
            price: "9900|Y", //usd cents
        },
    }
}