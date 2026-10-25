import org.junit.Test;

import static org.junit.Assert.assertTrue;

public class InventoryIT {
    @Test
    public void findsAvailableItem() {
        Inventory inventory = new Inventory();
        assertTrue(inventory.available("book"));
    }
}
