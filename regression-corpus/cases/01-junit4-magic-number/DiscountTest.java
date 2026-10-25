import org.junit.Test;

import static org.junit.Assert.assertEquals;

public class DiscountTest {
    @Test
    public void appliesDiscount() {
        Discount discount = new Discount();
        assertEquals(8, discount.apply(10));
    }
}
